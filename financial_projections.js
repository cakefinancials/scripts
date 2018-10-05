const fs = require('fs');
const plotly = require('plotly')('samuel.e.perez', /* NO NO */);
const program = require('commander');
const util = require('util');

program
    .version('0.1.0')
    .option('--mu <n>', 'mean of distribution', parseFloat)
    .option('--sigma <n>', 'sigma of distribution', parseFloat)
    .option('--upper <n>', 'upper bound in normal return', parseFloat)
    .option('--lower <n>', 'lower bound in normal return', parseFloat)
    .option('--discount <n>', 'discount percentage', parseFloat)
    .option('--period <n>', 'period in months', parseInt)
    .option('--iterations <n>', 'number of results to simulate', parseInt)
    .option('--histogram-file <filename>', 'name of histogram file')
    .parse(process.argv);

const { mu, sigma, upper, lower, period = 12, discount, iterations, histogramFile } = program;

const normDist = ({ mu = 0, sigma = 1 }) => {
    var x1, x2, rad;
    do {
        x1 = 2 * Math.random() - 1;
        x2 = 2 * Math.random() - 1;
        rad = x1 * x1 + x2 * x2;
    } while (rad >= 1 || rad == 0);
    var c = Math.sqrt(-2 * Math.log(rad) / rad);
    return sigma * x1 * c + mu;
};

const ratio = 12 / period;

const getSampleReturn = ({ mu, sigma, upper, lower }) => {
    let sample;
    do {
        sample = normDist({ mu: mu / ratio, sigma: sigma / Math.sqrt(ratio) });
    } while (!(lower < sample && sample < upper));

    const periodReturn = (1 + sample) / (1 - discount);
    return {
        sample,
        periodReturn,
        annualReturn: Math.pow(periodReturn, ratio)
    };
};

const getHistogram = async ({ samples }) => {
    const trace1 = {
        x: samples,
        type: 'histogram'
    };

    var figure = { 'data': [ trace1 ] };

    var imgOpts = {
        format: 'png',
        width: 1000,
        height: 500
    };

    const imageStream = await util.promisify(plotly.getImage).bind(plotly)(figure, imgOpts);
    await new Promise(resolve => {
        imageStream.pipe(fs.createWriteStream(histogramFile))
            .on('finish', resolve);
    });
};

const getMeanAndVar = ({ samples }) => {
    const getVariance = (samples, mean) => {
        const sumOfSquares = samples.reduce(
            (pre, sample) => {
                pre = pre + Math.pow((sample - mean), 2);
                return pre;
            },
            0
        );

        return sumOfSquares / samples.length;
    };

    const getMean = (samples) => {
        const meanTot = samples.reduce(
            (pre, sample) => {
                return pre + sample;
            },
            0
        );

        return meanTot / samples.length;
    };

    const mean = getMean(samples);

    return {
        mean,
        variance: getVariance(samples, mean)
    };
};


(async () => {
    const samples = [];
    const periodReturns = [];
    const annualReturns = [];
    for (let i = 0; i < iterations; i++) {
        let { sample, periodReturn, annualReturn } = getSampleReturn({ mu, sigma, upper, lower });
        samples.push(sample);
        periodReturns.push(periodReturn);
        annualReturns.push(annualReturn);
    }

    console.log('SAMPLES STATS:');
    console.log(getMeanAndVar({ samples: samples }));
    console.log('PERIOD RETURNS STATS:');
    console.log(getMeanAndVar({ samples: periodReturns }));
    console.log('ANNUAL RETURNS STATS:');
    console.log(getMeanAndVar({ samples: annualReturns }));

    //await getHistogram({ samples: returns });
})().then(() => console.log('done'));