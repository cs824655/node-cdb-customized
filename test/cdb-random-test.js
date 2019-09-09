const vows = require('vows');
const assert = require('assert');
const fs = require('fs');
const toCallback = require('./to-callback');
const Writable = require('../src/writable-cdb');
const Readable = require('../src/readable-cdb');

const randomFile = 'test/random.tmp';

try {
  fs.unlinkSync(randomFile);
} catch (err) { // eslint-disable-line no-empty
}

const pseudoRandom = (() => {
  let seed = 1073741823;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
})();

function getRandomInt(min, max) {
  return Math.floor(pseudoRandom() * (max - min)) + min;
}

function getRandomString(minLength, maxLength) {
  const length = getRandomInt(minLength, maxLength);
  const stringArray = [];
  for (let i = 0; i < length; i += 1) {
    stringArray.push(String.fromCharCode(getRandomInt(97, 122)));
  }

  return stringArray.join('');
}

function generateRandomRecords(count) {
  const randomRecords = {};
  for (let i = 0; i < count; i += 1) {
    const key = getRandomString(5, 10);
    const data = getRandomString(20, 30);

    if (key in randomRecords) {
      randomRecords[key].push(data);
    } else {
      randomRecords[key] = [data];
    }
  }

  return randomRecords;
}

function iterateOverRecords(records, callback) {
  const keys = Object.keys(records);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const data = records[key];
    for (let j = 0; j < data.length; j += 1) {
      callback(key, j, data[j]);
    }
  }
}

const recordCount = 1000;
const randomRecords = generateRandomRecords(recordCount);

vows.describe('cdb-random-test').addBatch({
  'An opened writable cdb': {
    topic() {
      toCallback((new Writable(randomFile)).open(), this.callback);
    },

    'should not error': (err, cdb) => { // eslint-disable-line no-unused-vars
      assert.equal(err, null);
    },

    'should add records without exception': (err, cdb) => {
      assert.doesNotThrow(() => {
        iterateOverRecords(randomRecords, (key, offset, data) => {
          cdb.put(key, data);
        });
      }, Error);
    },

    'should close': {
      topic(cdb) {
        toCallback(cdb.close(), this.callback);
      },

      'without error': (err) => {
        assert.equal(err, null);
      },
    },
  },
}).addBatch({
  'An opened readable cdb': {
    topic() {
      toCallback((new Readable(randomFile)).open(), this.callback);
    },

    'should not error': (err, cdb) => { // eslint-disable-line no-unused-vars
      assert.equal(err, null);
    },

    'when searching for existing keys': {
      topic(cdb) {
        let found = 0;
        let notFound = 0;
        let count = recordCount;
        const { callback } = this;

        function checkRecord(expected) {
          return (err, data) => {
            if (err || !data || data.toString() !== expected) {
              notFound += 1;
            } else {
              found += 1;
            }
            count -= 1;
            if (count === 0) {
              callback(notFound, found);
            }
          };
        }

        iterateOverRecords(randomRecords, (key, offset, data) => {
          toCallback(cdb.get(key, offset), checkRecord(data));
        });
      },

      'should find all of them': (notFound, found) => {
        assert.equal(found, recordCount);
        assert.equal(notFound, null);
      },
    },

    teardown(cdb) {
      toCallback((async () => {
        await cdb.close();
        fs.unlinkSync(randomFile);
      })(), this.callback);
    },
  },
}).export(module);
