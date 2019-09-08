const vows = require('vows');
const assert = require('assert');
const fs = require('fs');
const Writable = require('../src/writable-cdb');
const Readable = require('../src/readable-cdb');

const tempFile = 'test/tmp';
const fakeFile = 'test/doesntexist';

try {
  fs.unlinkSync(tempFile);
} catch (err) { // eslint-disable-line no-empty
}

vows.describe('cdb-test').addBatch({
  'A writable cdb': {
    topic() {
      return new Writable(tempFile);
    },

    'should not create a file when instantiated': () => {
      assert.throws(() => {
        fs.statSync(tempFile);
      }, Error);
    },

    'should respond to put': (cdb) => {
      assert.isFunction(cdb.put);
    },

    'should throw an error if not opened': (cdb) => {
      assert.throws(cdb.put, Error);
    },

    'when opened': {
      topic(cdb) {
        cdb.open(this.callback);
      },

      'should not error': (err, cdb) => { // eslint-disable-line no-unused-vars
        assert.equal(err, null);
      },

      'should create a file': (err, cdb) => { // eslint-disable-line no-unused-vars
        assert.isObject(fs.statSync(tempFile));
      },

      'should add records without exception': (cdb) => { // eslint-disable-line no-unused-vars
        assert.doesNotThrow(() => {
          cdb.put('meow', '0xdeadbeef');
          cdb.put('meow', '0xbeefdead');
          cdb.put('abcd', 'test1');
          cdb.put('abcd', 'offset_test');
          cdb.put('efgh', 'test2');
          cdb.put('ijkl', 'test3');
          cdb.put('mnopqrs', 'test4');
        }, Error);
      },

      'should close': {
        topic(cdb) {
          cdb.close(this.callback);
        },

        'without error': (err) => {
          assert.equal(err, null);
        },

        'and have a file with non-zero size': (err) => { // eslint-disable-line no-unused-vars
          const stat = fs.statSync(tempFile);
          assert.isObject(stat);
          assert.isTrue(stat.size !== 0);
        },
      },

    },
  },
}).addBatch({
  'A readable cdb': {
    'for a non-existing file': {
      topic() {
        return new Readable(fakeFile);
      },

      'when opened': {
        topic(cdb) {
          cdb.open(this.callback);
        },

        'should error': (err, cdb) => { // eslint-disable-line no-unused-vars
          assert.notEqual(err, null);
        },
      },
    },

    'for an existing file': {
      topic() {
        return new Readable(tempFile);
      },

      'when opened': {
        topic(cdb) {
          cdb.open(this.callback);
        },

        'should not error': (err, cdb) => { // eslint-disable-line no-unused-vars
          assert.equal(err, null);
        },

        'should find an existing key': {
          topic(cdb) {
            cdb.get('meow', this.callback);
          },

          'without error': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(err, null);
          },

          'and return the right data': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(data, '0xdeadbeef');
          },

          'with a duplicate': {
            topic(_, cdb) {
              cdb.getNext(this.callback);
            },

            'that is found via getNext()': (err, data) => { // eslint-disable-line no-unused-vars
              assert.equal(err, null);
              assert.equal(data, '0xbeefdead');
            },
          },
        },

        'should find an existing key at an offset': {
          topic(cdb) {
            cdb.get('abcd', 1, this.callback);
          },

          'without error': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(err, null);
          },

          'and return the right data': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(data, 'offset_test');
          },
        },

        'should not find a missing key': {
          topic(cdb) {
            cdb.get('kitty cat', this.callback);
          },

          'and should not error': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(err, null);
          },

          'and should have a null result': (err, data) => { // eslint-disable-line no-unused-vars
            assert.equal(data, null);
          },
        },
      },

      teardown(cdb) {
        cdb.close();
      },
    },

    'for an open existing file': {
      topic() {
        (new Readable(tempFile)).open(this.callback);
      },

      'when closed': {
        topic(cdb) {
          cdb.close(this.callback);
        },

        'should not error': (err, _) => { // eslint-disable-line no-unused-vars
          assert.equal(err, null);
        },
      },
    },

    teardown() {
      fs.unlinkSync(tempFile);
    },
  },
}).addBatch({
  'The CDB package\'s module.exports': {
    topic() {
      // eslint-disable-next-line global-require
      return require('../');
    },

    'should have a writable CDB': (index) => {
      assert.isFunction(index.writable);
    },

    'should have a readable CDB': (index) => {
      assert.isFunction(index.readable);
    },
  },
}).export(module);
