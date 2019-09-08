// === Setup ===
const fs = require('fs');

const Writable = require('../src/writable-cdb');
const Readable = require('../src/readable-cdb');

const pseudoRandom = (() => {
  // Lehmer random number generator
  let seed = 1234567890;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
})();

function getRandomInt(min, max) {
  return Math.floor(pseudoRandom() * (max - min)) + min;
}

// === Util ===
function getRandomString(minLength, maxLength) {
  const length = getRandomInt(minLength, maxLength);
  const stringArray = [];
  for (let i = 0; i < length; i += 1) {
    stringArray.push(String.fromCharCode(getRandomInt(97, 122)));
  }

  return stringArray.join('');
}

const CDB_FILE = 'benchmark/benchmark.tmp';
const COUNT = 50000;
const records = [];
const keyCount = {};

// Generate records
for (let recordIndex = 0; recordIndex < COUNT; recordIndex += 1) {
  const key = getRandomString(5, 10);
  const data = getRandomString(20, 30);
  const offset = keyCount[key] || 0;

  records.push({ key, data, offset });
  keyCount[key] = offset + 1;
}

// === Benchmark class ===
function Benchmark(options) {
  this.name = options.name;
  this.count = options.count;
  this.setup = options.setup;
  this.fn = options.fn;
  this.teardown = options.teardown;
  this.onComplete = options.onComplete;
}

// Process an array of benchmarks sequentially
Benchmark.process = function process(benchmarkArray, callback) {
  let i = 0;
  const { length } = benchmarkArray;

  function runBenchmark() {
    const currentBenchmark = benchmarkArray[i];
    i += 1;

    if (i < length) {
      currentBenchmark.onComplete = runBenchmark;
    } else {
      currentBenchmark.onComplete = callback;
    }

    currentBenchmark.run();
  }

  runBenchmark();
};

Benchmark.prototype.run = function run() {
  const {
    name, count, fn, teardown, onComplete,
  } = this;
  let i = 0;
  let startTime; let endTime; let duration; let seconds; let perSecond;

  function start() {
    startTime = Date.now();

    // eslint-disable-next-line no-use-before-define
    loop();
  }

  function loop() {
    if (i < count) {
      fn(i, loop);
      i += 1;
    } else {
      // eslint-disable-next-line no-use-before-define
      end();
    }
  }

  function end() {
    endTime = Date.now();
    duration = endTime - startTime;
    seconds = duration / 1000;
    perSecond = Math.floor((count / seconds) * 100) / 100;

    console.log(`${name} x${count} in ${seconds} seconds (${perSecond} per second).`);

    teardown(onComplete);
  }

  this.setup(start);
};

let writeCDB;
let readCDB;

// === Benchmarks ===
const writeBenchmark = new Benchmark({
  name: 'put()',
  count: COUNT,

  setup(callback) {
    writeCDB = new Writable(CDB_FILE);
    writeCDB.open(callback);
  },

  fn(iteration, callback) {
    const record = records[iteration];
    writeCDB.put(record.key, record.data, callback);
  },

  teardown(callback) {
    writeCDB.close(callback);
  },
});

const readBenchmark = new Benchmark({
  name: 'get()',
  count: COUNT,

  setup(callback) {
    readCDB = new Readable(CDB_FILE);
    readCDB.open(callback);
  },

  fn(iteration, callback) {
    const record = records[iteration];
    readCDB.get(record.key, record.offset, callback);
  },

  teardown(callback) {
    readCDB.close(callback);
  },
});

// === Main ===
Benchmark.process([writeBenchmark, readBenchmark], () => {
  fs.unlinkSync(CDB_FILE);
});
