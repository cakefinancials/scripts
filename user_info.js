/**
 * Helper script that will display user info.
 *
 * Dependencies: you have set up aws cli
 */

const co = require('co');
const execSync = require('child_process').execSync;
const openpgp = require('openpgp');
const Promise = require('bluebird');
const readlineSync = require('readline-sync');
const Writable = require('stream').Writable;
const logUpdate = require('log-update');

const getS3Contents = (s3Key) => {
    try {
        const command = `aws s3 cp ${s3Key} -`;
        return new String(execSync(command, {stdio : 'pipe' }));
    } catch (e) {
        return '';
    }
}

const printObject = (obj) => {
    const keys = Object.keys(obj);
    const lines = [];
    keys.forEach((key) => lines.push(`${key}: ${obj[key]}`));
    return lines;
};

const main = co.wrap(function* () {
    const privateKeyPassword = readlineSync.question(
        'What is the password for the private key? ',
        { hideEchoBack: true }
    );

    console.log('Downloading private key from s3');
    const privateKey = getS3Contents('s3://cake-financials-config/USER_DATA_PRIVATE_KEY');
    const privKeyObj = openpgp.key.readArmored(privateKey).keys[0];
    yield privKeyObj.decrypt(privateKeyPassword);

    const processNext = co.wrap(function*() {
        const email = readlineSync.question(
            'What is the email of the user you want to process? '
        );

        let idLinkKey
        try {
            idLinkKey = new String(execSync(
                `aws s3 ls s3://cake-financials-user-data/email_to_cognito_id/${email}/`
            ));
        } catch (e) {
            console.log('could not find a user with that email');
            return;
        }

        const cognitoIdenity = idLinkKey.split(' ').pop().trim();

        const lines = ['\n'];

        const bankInfo = getS3Contents(`s3://cake-financials-user-data/${cognitoIdenity}/bank_info`);
        if (bankInfo.length > 0) {
            const bankInfoOptions = {
                message: openpgp.message.readArmored(bankInfo),
                privateKeys: [privKeyObj]
            };
            const bankInfoPlaintext = yield openpgp.decrypt(bankInfoOptions);
            lines.push('Bank Info:');
            (printObject(JSON.parse(bankInfoPlaintext.data))).forEach((line) => lines.push(line));
        } else {
            lines.push('No bank info to display');
        }

        const brokerageCredentials = getS3Contents(`s3://cake-financials-user-data/${cognitoIdenity}/brokerage_credentials`);
        if (brokerageCredentials.length > 0) {
            const brokerageCredentialsOptions = {
                message: openpgp.message.readArmored(brokerageCredentials),
                privateKeys: [privKeyObj]
            };
            const brokerageCredentialsPlaintext = yield openpgp.decrypt(brokerageCredentialsOptions);
            lines.push('Brokerage Credentials:');

            (printObject(JSON.parse(brokerageCredentialsPlaintext.data))).forEach((line) => lines.push(line));
        } else {
            lines.push('No brokerage credentials to display');
        }

        lines.push(`hit enter to erase and proceed`);
        const log = logUpdate.create(process.stdout, {
            showCursor: true
        });

        log(lines.join('\n'));
        readlineSync.question();
        log.clear();
    });

    while (true) {
        yield processNext();
    }
});

main().then(() => console.log('done')).catch(console.error);