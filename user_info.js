/**
 * Helper script that will display user info.
 *
 * Dependencies: you have set up aws cli
 */

const util = require('util');
const { exec, execSync } = require('child_process');
const execAsync = util.promisify(exec);
const openpgp = require('openpgp');
const Promise = require('bluebird');
const readlineSync = require('readline-sync');
const logUpdate = require('log-update');
const R = require('ramda');
const moment = require('moment');

const ENVIRONMENT = process.env['NODE_ENV'] || 'dev';

const getS3Contents = ({ s3Key, async = false }) => {
    try {
        const command = `aws s3 cp ${s3Key} -`;
        if (async) {
            return execAsync(command, { stdio: 'pipe' }).then(result => {
                return result.stdout;
            });
        } else {
            return new String(execSync(command, { stdio : 'pipe' }));
        }
    } catch (e) {
        return '';
    }
};

const printObject = (obj) => {
    const keys = Object.keys(obj);
    const lines = [];
    keys.forEach((key) => lines.push(`${key}: ${obj[key]}`));
    return lines;
};

let stripeSecret, plaidClientId, plaidSecret, plaidPublicKey, plaidEnv, privateKey;

const main = async () => {
    console.log('Loading...');
    ([
        stripeSecret,
        plaidClientId,
        plaidSecret,
        plaidPublicKey,
        plaidEnv,
        privateKey
    ] = await Promise.all([
        getS3Contents({ s3Key: `s3://cake-financials-config/${ENVIRONMENT}/STRIPE_PRIVATE_KEY`, async: true }),
        getS3Contents({ s3Key: 's3://cake-financials-config/PLAID_CLIENT_ID', async: true }),
        getS3Contents({ s3Key: `s3://cake-financials-config/${ENVIRONMENT}/PLAID_SECRET_KEY`, async: true }),
        getS3Contents({ s3Key: 's3://cake-financials-config/PLAID_PUBLIC_KEY', async: true }),
        getS3Contents({ s3Key: `s3://cake-financials-config/${ENVIRONMENT}/PLAID_ENVIRONMENT`, async: true }),
        getS3Contents({ s3Key: 's3://cake-financials-config/USER_DATA_PRIVATE_KEY', async: true })
    ]));

    console.log('Ready to go...');

    const privateKeyPassword = readlineSync.question(
        'What is the password for the private key? ',
        { hideEchoBack: true }
    );

    const privKeyObj = openpgp.key.readArmored(privateKey).keys[0];
    await privKeyObj.decrypt(privateKeyPassword);

    const processNext = async () => {
        const email = readlineSync.question(
            'What is the email of the user you want to process? '
        );

        let idLinkKey;
        try {
            idLinkKey = new String(execSync(
                `aws s3 ls s3://cake-financials-user-data/email_to_cognito_id/${email}/`
            ));
        } catch (e) {
            console.log('could not find a user with that email');
            return;
        }

        const cognitoIdenity = idLinkKey.split(' ').pop().trim();

        let runWithSameUser = true;
        while (runWithSameUser) {
            ({ runWithSameUser } = await runUserCommand({ cognitoIdenity, privKeyObj }));
        }
    };

    while (true) {
        await processNext();
    }
};

const runUserCommand = async ({ cognitoIdenity, privKeyObj }) => {
    console.log(R.pipe(
        R.mapObjIndexed(({ name }, index) => `${index}) ${name}`),
        R.values,
        R.join('\n')
    )(USER_COMMANDS));
    const commandNumber = readlineSync.question(
        'What is the command you want to run (type the number, or "exit" to process another user)? '
    );

    if (commandNumber === 'exit') {
        return { runWithSameUser: false };
    }
    const commandFn = R.path([ commandNumber, 'fn' ], USER_COMMANDS);

    if (!commandFn) {
        console.log(`'${commandNumber}' was not recognized...`);
        return { runWithSameUser: true };
    }

    const commandResult = await commandFn({ cognitoIdenity, privKeyObj });
    const lines = [ ...commandResult, '\n' ];

    lines.push('hit enter to erase and proceed');
    const log = logUpdate.create(process.stdout, {
        showCursor: true
    });

    log(lines.join('\n'));
    readlineSync.question();
    log.clear();
    return { runWithSameUser: true };
};

const USER_COMMANDS = [
    {
        name: 'VIEW PLAID TRANSACTIONS',
        fn: async function viewPlaidTransaction({ cognitoIdenity }) {
            const plaid = require('plaid');

            var plaidClient = new plaid.Client(
                plaidClientId,
                plaidSecret,
                plaidPublicKey,
                plaid.environments[plaidEnv]
            );

            const contents = getS3Contents({ s3Key: `s3://cake-financials-user-data/${cognitoIdenity}/user_plaid_data.json` });
            if (!contents) {
                return [ 'This user has not linked their bank account' ];
            }

            const now = moment();
            const aMonthAgo = now.subtract(30, 'd');

            const { plaidAccessToken } = JSON.parse(contents);
            //const plaidAccessToken = 'access-development-c4285019-1257-4825-956e-150b686d0082';

            const lines = [ ];

            try {
                const transactionsResponse = await plaidClient.getTransactions(
                    plaidAccessToken,
                    aMonthAgo.format('YYYY-MM-DD'),
                    now.format('YYYY-MM-DD'),
                );

                const { transactions } = transactionsResponse;
                if (transactions.length === 0) {
                    lines.push('Did not find any transactions');
                } else {
                    lines.push('Transactions over last month: (Date: Amount)');
                    R.forEach(
                        ({ amount, date }) => lines.push(`${date}: ${amount}`),
                        transactions
                    );
                }
            } catch (err) {
                lines.push('An error occurred while fetching transactions from Plaid');
                lines.push(`${err.error_code}: ${err.error_message}`);
            }

            const authResponse = await plaidClient.getAuth(plaidAccessToken);
            const balances = authResponse.accounts[0].balances;
            lines.push(`Current: ${balances.current}, Available: ${balances.available}`);

            return lines;
        }
    },
    {
        name: 'VIEW BROKERAGE CREDENTIALS',
        fn: async function viewBrokerageCredentials({ cognitoIdenity, privKeyObj }) {
            const brokerageCredentials = getS3Contents({ s3Key: `s3://cake-financials-user-data/${cognitoIdenity}/brokerage_credentials` });
            const lines = [ ];

            if (brokerageCredentials.length > 0) {
                const brokerageCredentialsOptions = {
                    message: openpgp.message.readArmored(brokerageCredentials),
                    privateKeys: [ privKeyObj ]
                };
                const brokerageCredentialsPlaintext = await openpgp.decrypt(brokerageCredentialsOptions);
                lines.push('Brokerage Credentials:');

                (printObject(JSON.parse(brokerageCredentialsPlaintext.data))).forEach((line) => lines.push(line));
            } else {
                lines.push('No brokerage credentials to display');
            }

            return lines;
        }
    },
    {
        name: 'CHARGE WITH STRIPE',
        fn: async function viewBrokerageCredentials({ cognitoIdenity }) {
            const contents = getS3Contents({ s3Key: `s3://cake-financials-user-data/${cognitoIdenity}/user_plaid_data.json` });
            if (!contents) {
                return [ 'This user has not linked their bank account' ];
            }

            const { bankAccountToken } = JSON.parse(contents);

            const amountToCharge = readlineSync.question(
                'How much do you want to charge? '
            );

            const parsedAmountToCharge = parseFloat(amountToCharge).toFixed(2);

            const answer = readlineSync.question(`Are you sure you want to charge ${parsedAmountToCharge}? Type 'y' for yes: `);

            const lines = [ ];
            if (answer !== 'y') {
                lines.push('Aborting...');
            } else {
                // charge with stripe
                lines.push('Charging...');
                const stripe = require('stripe')(stripeSecret);

                const chargeInCents = parsedAmountToCharge * 100;

                try {
                    const charge = await stripe.charges.create({
                        amount: chargeInCents,
                        currency: 'usd',
                        source: bankAccountToken, // obtained with Stripe.js
                        description: `Charge for Cake services ending ${moment().format('MMMM Do YYYY')}`
                    });

                    lines.push('Succesfully charged');
                    console.log(JSON.stringify(charge, null, 4));
                } catch (err) {
                    console.log('Error while charging, dumping out the error: ', err);
                }
            }
            return lines;
        }
    }
];

main().then(() => console.log('done')).catch(console.error);