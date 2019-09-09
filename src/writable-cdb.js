const events = require('events');
const fs = require('fs');
const doAsync = require('doasync');
const { cdbHash } = require('./cdb-util');

const asyncFs = doAsync(fs);

const HEADER_SIZE = 2048;
const TABLE_SIZE = 256;

/*
* Returns an allocated buffer containing the binary representation of a CDB
* header. The header contains 255 (count, position) pairs representing the
* number of slots and position of the hashtables.
*/
function getBufferForHeader(headerTable) {
  const buffer = Buffer.from({ length: HEADER_SIZE });
  let bufferPosition = 0;

  for (let i = 0; i < TABLE_SIZE; i += 1) {
    const { position, slots } = headerTable[i];

    buffer.writeUInt32LE(position, bufferPosition);
    buffer.writeUInt32LE(slots, bufferPosition + 4); // 4 bytes per int
    bufferPosition += 8;
  }

  return buffer;
}

// === Helper functions ===

/*
* Returns an allocated buffer containing the binary representation of a CDB
* hashtable. Hashtables are linearly probed, and use a load factor of 0.5, so
* the buffer will have 2n slots for n entries.
*
* Entries are made up of two 32-bit unsigned integers for a total of 8 bytes.
*/
function getBufferForHashtable(hashtable) {
  const { length } = hashtable;
  const slotCount = length * 2;
  const buffer = Buffer.from({ length: slotCount * 8 });

  // zero out the buffer
  buffer.fill(0);

  for (let i = 0; i < length; i += 1) {
    const { hash, position } = hashtable[i];

    // eslint-disable-next-line no-bitwise
    let slot = (hash >>> 8) % slotCount;
    // console.log(`*********** getBufferForHashtable checking empty slot ${slot}`);
    let bufferPosition = slot * 8;

    // look for an empty slot
    while (buffer.readUInt32LE(bufferPosition) !== 0) {
      // this slot is occupied
      slot = (slot + 1) % slotCount;
      bufferPosition = slot * 8;
      // console.log(`*********** getBufferForHashtable slot was not empty, checking empty slot ${slot}`);
    }

    // console.log(`*********** getBufferForHashtable bufferPosition: ${bufferPosition} pointing to hash: 0x${hash.toString(16)} position: 0x${position.toString(16)}`);
    buffer.writeUInt32LE(hash, bufferPosition);
    buffer.writeUInt32LE(position, bufferPosition + 4);
  }

  return buffer;
}

class Writable {
  constructor(file) {
    this.file = file;
    this.filePosition = 0;

    this.header = new Array(TABLE_SIZE);
    this.hashtables = new Array(TABLE_SIZE);

    this.recordStream = null;
    this.hashtableStream = null;
  }

  async open() {
    // console.log(`*********** opening file for writing: ${this.file} at start 0x${HEADER_SIZE.toString(16)}`);
    const recordStream = fs.createWriteStream(this.file, { start: HEADER_SIZE });

    return new Promise((resolve, reject) => {
      let alreadFinished = false;

      const onceOpen = () => {
        if (alreadFinished) {
          return;
        }
        this.recordStream = recordStream;
        this.filePosition = HEADER_SIZE;

        recordStream.removeListener('error', onceError);
        alreadFinished = true;
        resolve(this);
      };

      const onceError = (err) => {
        if (alreadFinished) {
          return;
        }
        recordStream.removeListener('open', onceOpen);
        alreadFinished = true;
        reject(err);
      };

      recordStream.once('error', onceError);
      recordStream.once('open', onceOpen);
    });
  }

  put(key, data, callback) {
    const keyLength = Buffer.byteLength(key);
    const dataLength = Buffer.byteLength(data);
    const record = Buffer.from({ length: 8 + keyLength + dataLength });
    const hash = cdbHash(key);
    // eslint-disable-next-line no-bitwise
    const hashtableIndex = hash & 255;

    record.writeUInt32LE(keyLength, 0);
    record.writeUInt32LE(dataLength, 4);
    record.write(key, 8);
    record.write(data, 8 + keyLength);

    // console.log(`*********** writing key ${key} data ${data} record ${record.toString('hex')} to file position 0x${this.filePosition.toString(16)}`);
    const okayToWrite = this.recordStream.write(record, callback);

    let hashtable = this.hashtables[hashtableIndex];
    if (!hashtable) {
      hashtable = [];
      this.hashtables[hashtableIndex] = hashtable;
    }

    hashtable.push({ hash, position: this.filePosition });

    this.filePosition += record.length;

    return okayToWrite;
  }

  close(cb) {
    const self = this;
    const callback = cb || function nothing() {};

    // eslint-disable-next-line no-use-before-define
    this.recordStream.on('finish', openStreamForHashtable);
    this.recordStream.end();

    function openStreamForHashtable() {
      // console.log(`*********** opening file for hashtable writing: ${this.file} at start 0x${self.filePosition.toString(16)}`);
      self.hashtableStream = fs.createWriteStream(self.file, { start: self.filePosition, flags: 'r+' });

      // eslint-disable-next-line no-use-before-define
      self.hashtableStream.once('open', writeHashtables);
      // eslint-disable-next-line no-use-before-define
      self.hashtableStream.once('error', error);
    }

    function writeHashtables() {
      const { length } = self.hashtables;

      for (let i = 0; i < length; i += 1) {
        const hashtable = self.hashtables[i] || [];
        // eslint-disable-next-line no-use-before-define
        const buffer = getBufferForHashtable(hashtable);

        if (buffer.length > 0) {
          // console.log(`*********** writing the buffer at 0x${self.filePosition.toString(16)}`);
          self.hashtableStream.write(buffer);
        }

        self.header[i] = {
          position: self.filePosition,
          slots: hashtable.length * 2,
        };

        self.filePosition += buffer.length;

        // free the hashtable
        self.hashtables[i] = null;
      }

      // eslint-disable-next-line no-use-before-define
      self.hashtableStream.on('finish', writeHeader);
      self.hashtableStream.end();
    }

    function writeHeader() {
      // eslint-disable-next-line no-use-before-define
      const buffer = getBufferForHeader(self.header);

      // eslint-disable-next-line no-use-before-define
      fs.writeFile(self.file, buffer, { flag: 'r+' }, finished);
    }

    function finished() {
      // self.emit('finish');
      callback();
    }

    function error(err) {
      // self.emit('error', err);
      callback(err);
    }
  }
}

module.exports = Writable;
