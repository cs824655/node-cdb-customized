'use strict';

const vows = require('vows');
const assert = require('assert');
const fs = require('fs');
const writable = require('../src/writable-cdb');
const readable = require('../src/readable-cdb');
const randomFile = 'test/random';

try {
  fs.unlinkSync(randomFile);
} catch (err) {}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function getRandomString(minLength, maxLength) {
  const length = getRandomInt(minLength, maxLength);
  const stringArray = [];
  for (let i = 0; i < length; i++) {
    stringArray.push(String.fromCharCode(getRandomInt(97, 122)));
  }
  
  return stringArray.join('');
}

function generateRandomRecords(count) {
  const randomRecords = {};
  for (let i = 0; i < count; i++) {
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
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const data = records[key];
    for (let j = 0; j < data.length; j++) {
      callback(key, j, data[j]);
    }
  }
}

const recordCount = 1000;
const randomRecords = generateRandomRecords(recordCount);

vows.describe('cdb-random-test').addBatch({
  'An opened writable cdb': {
    topic: function() {
      (new  writable(randomFile)).open(this.callback);
    },
    
    'should not error': function(err, cdb) {
      assert.equal(err, null);
    },
    
    'should add records without exception': function(err, cdb) {
      assert.doesNotThrow(function() {
        iterateOverRecords(randomRecords, function(key, offset, data) {
          cdb.put(key, data);
        });
      }, Error);
    },
    
    'should close': {
      topic: function(cdb) {
        cdb.close(this.callback);
      },
      
      'without error': function(err, cdb) {
        assert.equal(err, null);
      }
    }
  }
}).addBatch({
  'An opened readable cdb': {
    topic: function() {
      (new readable(randomFile)).open(this.callback);
    },
    
    'should not error': function(err, cdb) {
      assert.equal(err, null);
    },
    
    'when searching for existing keys': {
      topic: function(cdb) {
        let found = 0;
        let notFound = 0;
        let count = recordCount;
        const callback = this.callback;
        
        function checkRecord(expected) {
          return function(err, data) {
            if (err || data != expected) {
              notFound++;
            } else {
              found++;
            }
            
            if (--count === 0) {
              callback(notFound, found);
            }
          };
        }
        
        iterateOverRecords(randomRecords, function(key, offset, data) {
          cdb.get(key, offset, checkRecord(data));
        });
      },
      
      'should find all of them': function(notFound, found) {
        assert.equal(notFound, null);
        assert.equal(found, recordCount);
      }
    },
    
    teardown: function(cdb) {
      cdb.close();
      fs.unlinkSync(randomFile);
    }
  }
}).export(module);
