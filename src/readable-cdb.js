const fs = require('fs');
const doAsync = require('doasync');
const { cdbHash } = require('./cdb-util');

const asyncFs = doAsync(fs);

const HEADER_SIZE = 2048;
const TABLE_SIZE = 256;

class Readable {
  constructor(file) {
    this.file = file;
    this.header = new Array(TABLE_SIZE);

    this.fd = null;
  }

  async open() {
    this.fd = await asyncFs.open(this.file, 'r');
    const { buffer } = await asyncFs.read(this.fd, Buffer.from({ length: HEADER_SIZE }), 0, HEADER_SIZE, 0);

    let bufferPosition = 0;
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const position = buffer.readUInt32LE(bufferPosition);
      const slotCount = buffer.readUInt32LE(bufferPosition + 4);

      this.header[i] = {
        position,
        slotCount,
      };

      bufferPosition += 8;
    }

    return this;
  }

  async* getIterator(key, offsetParam = 0) {
    // console.log(`*********** Readable.get ${key} offset: ${offsetParam}`);

    const trueKeyLength = Buffer.byteLength(key);
    const hash = cdbHash(key);
    // eslint-disable-next-line no-bitwise
    const { position, slotCount } = this.header[hash & 255];
    // console.log(`*********** position ${position} slotCount: ${slotCount}`);

    let offset = offsetParam;

    if (slotCount === 0) {
      return null;
    }

    // eslint-disable-next-line no-bitwise
    const initialSlot = (hash >>> 8) % slotCount;

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const hashPosition = position + (((initialSlot + slotIndex) % slotCount) * 8);
      // console.log(`*********** reading slot ${slotIndex} at ${hashPosition}`);

      // eslint-disable-next-line no-await-in-loop
      const { buffer: slotBuffer } = await asyncFs.read(this.fd, Buffer.from({ length: 8 }), 0, 8, hashPosition);

      const recordHash = slotBuffer.readUInt32LE(0);
      const recordPosition = slotBuffer.readUInt32LE(4);
      // console.log(`*********** recordHash 0x${recordHash.toString(16)} recordPosition 0x${recordPosition.toString(16)}`);

      if (recordPosition === 0) {
        // console.log(`*********** did not find data because an empty record was reached ${recordPosition} ${recordHash}`);
        return null;
      }
      // console.log(`*********** found hash 0x${hash.toString(16)}`);
      if (recordHash === hash) {
        // eslint-disable-next-line no-await-in-loop
        const { buffer: recordHeader } = await asyncFs.read(this.fd, Buffer.from({ length: 8 }), 0, 8, recordPosition);

        const keyLength = recordHeader.readUInt32LE(0);
        const dataLength = recordHeader.readUInt32LE(4);

        // In the rare case that there is a hash collision, check the key size
        // to prevent reading in a key that will definitely not match.
        // console.log(`*********** keyLength ${keyLength} trueKeyLength ${trueKeyLength}`);
        if (keyLength === trueKeyLength) {
          // eslint-disable-next-line no-await-in-loop
          const { buffer: keyPayload } = await asyncFs.read(this.fd, Buffer.from({ length: keyLength }), 0, keyLength, recordPosition + 8);
          // console.log(`*********** found key ${keyPayload}`);
          if (keyPayload.toString() === key) {
            // console.log(`*********** same key - offset is ${offset}`);
            if (offset === 0) {
              // eslint-disable-next-line no-await-in-loop
              const { buffer: valuePayload } = await asyncFs.read(this.fd, Buffer.from({ length: dataLength }), 0, dataLength, recordPosition + 8 + keyLength);
              yield valuePayload;
            } else {
              // console.log(`*********** reducing offset ${offset} by 1`);
              offset -= 1;
            }
          }
        }
      }
    }
    // console.log(`*********** did not find data because all records have been scanned ${slotCount}`);
    return null;
  }

  async get(key, offset = 0) {
    return (await this.getIterator(key, offset).next()).value;
  }

  async close() {
    await asyncFs.close(this.fd);
  }
}

module.exports = Readable;
