const fs = require('fs');
const doAsync = require('doasync');
const {
  pointerEncoding,
  slotIndexEncoding,
  keyLengthEncoding,
  dataLengthEncoding,
  hashEncoding,
  TABLE_SIZE,
  HEADER_SIZE,
  MAIN_PAIR_SIZE,
  HASH_PAIR_SIZE,
  RECORD_HEADER_SIZE,
  defaultHash,
} = require('./cdb-util');

const asyncFs = doAsync(fs);

class Readable {
  constructor(file, hash = defaultHash) {
    this.file = file;
    this.header = new Array(TABLE_SIZE);
    this.hash = hash;

    this.fd = null;
  }

  async open() {
    this.fd = await asyncFs.open(this.file, 'r');
    const { buffer } = await asyncFs.read(this.fd, Buffer.alloc(HEADER_SIZE), 0, HEADER_SIZE, 0);

    let bufferPosition = 0;
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const position = pointerEncoding.read(buffer, bufferPosition);
      const slotCount = slotIndexEncoding.read(buffer, bufferPosition + pointerEncoding.size);

      this.header[i] = {
        position,
        slotCount,
      };

      bufferPosition += MAIN_PAIR_SIZE;
    }

    return this;
  }

  async* getIterator(keyParam, offsetParam = 0) {
    // console.log(`*********** Readable.get ${key} offset: ${offsetParam}`);
    const key = Buffer.from(keyParam);

    const hash = this.hash(key);
    // eslint-disable-next-line no-bitwise
    const { position, slotCount } = this.header[hash & 0xFFn];
    // console.log(`*********** position ${position} slotCount: ${slotCount}`);

    let offset = offsetParam;

    if (slotCount === 0) {
      return;
    }

    // eslint-disable-next-line no-bitwise
    const initialSlot = Number((hash >> 8n) % BigInt(slotCount));

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const hashPosition = position + (((initialSlot + slotIndex) % slotCount) * HASH_PAIR_SIZE);
      // console.log(`*********** reading slot ${slotIndex} at ${hashPosition}`);

      // eslint-disable-next-line no-await-in-loop
      const { buffer: slotBuffer } = await asyncFs.read(this.fd, Buffer.alloc(HASH_PAIR_SIZE), 0, HASH_PAIR_SIZE, hashPosition);

      const recordHash = hashEncoding.read(slotBuffer, 0);
      const recordPosition = pointerEncoding.read(slotBuffer, hashEncoding.size);
      // console.log(`*********** recordHash 0x${recordHash.toString(16)} recordPosition 0x${recordPosition.toString(16)}`);

      if (recordPosition === 0) {
        // console.log(`*********** did not find data because an empty record was reached ${recordPosition} ${recordHash}`);
        return;
      }
      // console.log(`*********** found hash 0x${hash.toString(16)}`);
      if (recordHash === hash) {
        // eslint-disable-next-line no-await-in-loop
        const { buffer: recordHeader } = await asyncFs.read(this.fd, Buffer.alloc(RECORD_HEADER_SIZE), 0, RECORD_HEADER_SIZE, recordPosition);

        const keyLength = keyLengthEncoding.read(recordHeader, 0);
        const dataLength = dataLengthEncoding.read(recordHeader, keyLengthEncoding.size);

        // In the rare case that there is a hash collision, check the key size
        // to prevent reading in a key that will definitely not match.
        // console.log(`*********** keyLength ${keyLength} trueKeyLength ${trueKeyLength}`);
        if (keyLength === key.length) {
          // eslint-disable-next-line no-await-in-loop
          const { buffer: keyPayload } = await asyncFs.read(this.fd, Buffer.alloc(keyLength), 0, keyLength, recordPosition + RECORD_HEADER_SIZE);
          // console.log(`*********** found key ${keyPayload}`);
          if (Buffer.compare(keyPayload, key) === 0) {
            // console.log(`*********** same key - offset is ${offset}`);
            if (offset === 0) {
              // eslint-disable-next-line no-await-in-loop
              const { buffer: valuePayload } = await asyncFs.read(this.fd, Buffer.alloc(dataLength), 0, dataLength, recordPosition + RECORD_HEADER_SIZE + keyLength);
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
  }

  async get(key, offset = 0) {
    return (await this.getIterator(key, offset).next()).value;
  }

  async close() {
    await asyncFs.close(this.fd);
  }
}

module.exports = Readable;
