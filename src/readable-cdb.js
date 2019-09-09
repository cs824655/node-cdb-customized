const fs = require('fs');
const { cdbHash } = require('./cdb-util');

const HEADER_SIZE = 2048;
const TABLE_SIZE = 256;

class Readable {
  constructor(file) {
    this.file = file;
    this.header = new Array(TABLE_SIZE);

    this.fd = null;
    this.bookmark = null;
  }

  open(callback) {
    const self = this;

    function readHeader(err, fd) {
      if (err) {
        return callback(err);
      }

      self.fd = fd;
      // eslint-disable-next-line no-use-before-define
      return fs.read(fd, Buffer.from({ length: HEADER_SIZE }), 0, HEADER_SIZE, 0, parseHeader);
    }

    function parseHeader(err, bytesRead, buffer) {
      if (err) {
        return callback(err);
      }

      let bufferPosition = 0;
      for (let i = 0; i < TABLE_SIZE; i += 1) {
        const position = buffer.readUInt32LE(bufferPosition);
        const slotCount = buffer.readUInt32LE(bufferPosition + 4);

        self.header[i] = {
          position,
          slotCount,
        };

        bufferPosition += 8;
      }

      return callback(null, self);
    }

    fs.open(this.file, 'r', readHeader);
  }

  get(key, offsetParam, callbackParam) {
    let offset = offsetParam;
    let callback = callbackParam;

    if (typeof (offset) === 'function') {
      callback = offset;
      offset = 0;
    }

    // console.log(`*********** Readable.get ${key} offset: ${offset}`);

    this.bookmark = null;
    const self = this;
    const trueKeyLength = Buffer.byteLength(key);
    const hash = cdbHash(key);
    // eslint-disable-next-line no-bitwise
    const { position, slotCount } = this.header[hash & 255];
    // console.log(`*********** position ${position} slotCount: ${slotCount}`);

    // eslint-disable-next-line no-bitwise
    let slot = (hash >>> 8) % slotCount;
    let recordPosition;
    let keyLength;
    let dataLength;

    if (slotCount === 0) {
      // console.log('*********** did not find data because slotCount is 0');
      return callback(null, null);
    }

    function readSlot(currentSlot) {
      const hashPosition = position + ((currentSlot % slotCount) * 8);
      // console.log(`*********** reading slot ${currentSlot} at ${hashPosition}`);

      // eslint-disable-next-line no-use-before-define
      fs.read(self.fd, Buffer.from({ length: 8 }), 0, 8, hashPosition, checkHash);
    }

    function checkHash(err, bytesRead, buffer) {
      if (err) {
        return callback(err);
      }

      const recordHash = buffer.readUInt32LE(0);
      recordPosition = buffer.readUInt32LE(4);
      // console.log(`*********** recordHash 0x${recordHash.toString(16)} recordPosition 0x${recordPosition.toString(16)}`);

      if (recordHash === hash) {
        // eslint-disable-next-line no-use-before-define
        return fs.read(self.fd, Buffer.from({ length: 8 }), 0, 8, recordPosition, readKey);
      }
      if (recordHash === 0) {
        // console.log('*********** did not find data because there are no more records');
        return callback(null, null);
      }
      // console.log('*********** searching in next slot because hash is different');
      slot += 1;
      return readSlot(slot);
    }

    function readKey(err, bytesRead, buffer) {
      if (err) {
        return callback(err);
      }

      keyLength = buffer.readUInt32LE(0);
      dataLength = buffer.readUInt32LE(4);

      // In the rare case that there is a hash collision, check the key size
      // to prevent reading in a key that will definitely not match.
      if (keyLength !== trueKeyLength) {
        // console.log('*********** searching in next slot because key length is different');
        slot += 1;
        return readSlot(slot);
      }

      // eslint-disable-next-line no-use-before-define
      return fs.read(self.fd, Buffer.from({ length: keyLength }), 0, keyLength, recordPosition + 8, checkKey);
    }

    function checkKey(err, bytesRead, buffer) {
      if (err) {
        return callback(err);
      }

      if (buffer.toString() === key) {
        // console.log('*********** found key');
        if (offset === 0) {
          // eslint-disable-next-line no-use-before-define
          return fs.read(self.fd, Buffer.from({ length: dataLength }), 0, dataLength, recordPosition + 8 + keyLength, returnData);
        }
        // console.log(`*********** reducing offset ${offset} by 1`);
        offset -= 1;
      }
      slot += 1;
      return readSlot(slot);
    }

    function returnData(err, bytesRead, buffer) {
      // Fill out bookmark information so getNext() will work
      self.bookmark = function bookmark(newCallback) {
        self.bookmark = null;
        callback = newCallback;
        slot += 1;
        readSlot(slot);
      };

      // console.log(`*********** found data: ${buffer.toString()}`);
      callback(err, buffer);
    }

    return readSlot(slot);
  }

  getNext(callback) {
    if (!this.bookmark) {
      return callback(null, null);
    }
    return this.bookmark(callback);
  }

  close(callback) {
    fs.close(this.fd, callback || (() => {}));
  }
}

module.exports = Readable;
