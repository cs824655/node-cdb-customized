const fs = require('fs');
const doAsync = require('doasync');
const { defaultHash } = require('./cdb-util');
import Encoding from './cdb-encoding';

const asyncFs = doAsync(fs);

class Writable {
  constructor(file, options) {
    this.encoding = new Encoding(options ? options : {});
    this.file = file;
    this.filePosition = 0;
    this.hash = (options && options.hash) ? options.hash : defaultHash;

    this.header = new Array(this.encoding.tableSize);
    this.hashtables = new Array(this.encoding.tableSize);

    this.hashtableStream = null;
    this.recordStream = null;
    this.recordStreamError = null;
    this._recordStreamErrorSaver = (err) => {
      this.recordStreamError = err;
      const waiters = this._recordStreamDrainWaiters;
      this._recordStreamDrainWaiters = new Set();
      waiters.forEach(({ reject }) => reject(err));
    };
    this._recordStreamDrainWaiters = new Set();
    this._recordStreamDrainCaller = () => {
      // listeners should be safe functions
      // for safety
      const waiters = this._recordStreamDrainWaiters;
      this._recordStreamDrainWaiters = new Set();
      waiters.forEach(({ resolve }) => resolve());
    };
  }

  // === Helper functions ===

  /*
  * Returns an allocated buffer containing the binary representation of a CDB
  * hashtable. Hashtables are linearly probed, and use a load factor of 0.5, so
  * the buffer will have 2n slots for n entries.
  *
  * Entries are made up of two 32-bit unsigned integers for a total of 8 bytes.
  */
  #getBufferForHashtable(hashtable) {
    const { length } = hashtable;
    const slotCount = length * 2;
    const buffer = Buffer.alloc(slotCount * this.encoding.hashPairSize);

    // zero out the buffer
    buffer.fill(0);

    for (let i = 0; i < length; i += 1) {
      const { hash, position } = hashtable[i];

      // eslint-disable-next-line no-bitwise
      let slot = (hash >> 8) % slotCount;
      // console.log(`*********** getBufferForHashtable checking empty slot ${slot}`);
      let bufferPosition = slot * this.encoding.hashPairSize;

      // look for an empty slot
      while (this.encoding.pointerEncoding.read(buffer, bufferPosition + this.encoding.hashEncoding.size) !== 0) {
        // this slot is occupied
        slot = (slot + 1) % slotCount;
        bufferPosition = slot * this.encoding.hashPairSize;
        // console.log(`*********** getBufferForHashtable slot was not empty, checking empty slot ${slot}`);
      }

      // console.log(`*********** getBufferForHashtable bufferPosition: ${bufferPosition} pointing to hash: 0x${hash.toString(16)} position: 0x${position.toString(16)}`);
      this.encoding.hashEncoding.write(buffer, hash, bufferPosition);
      this.encoding.pointerEncoding.write(buffer, position, bufferPosition + this.encoding.hashEncoding.size);
    }

    return buffer;
  }

  async open() {
    // console.log(`*********** opening file for writing: ${this.file} at start 0x${this.encoding.headerSize.toString(16)}`);
    const recordStream = fs.createWriteStream(this.file, { start: this.encoding.headerSize });

    return new Promise((resolve, reject) => {
      let alreadyFinished = false;

      const onceOpen = () => {
        if (alreadyFinished) {
          return;
        }
        this.recordStream = recordStream;
        this.filePosition = this.encoding.headerSize;
        recordStream.once('error', this._recordStreamErrorSaver);
        recordStream.on('drain', this._recordStreamDrainCaller);
        recordStream.removeListener('error', onceError);
        alreadyFinished = true;
        resolve(this);
      };

      const onceError = (err) => {
        if (alreadyFinished) {
          return;
        }
        recordStream.removeListener('open', onceOpen);
        alreadyFinished = true;
        reject(err);
      };

      recordStream.once('error', onceError);
      recordStream.once('open', onceOpen);
    });
  }

  async put(keyParam, dataParam) {
    const key = Buffer.from(keyParam);
    const data = Buffer.from(dataParam);
    if (this.recordStreamError) {
      throw this.recordStreamError; // if set write operations are no longer permitted
    }
    const record = Buffer.alloc(this.encoding.recordHeaderSize + key.length + data.length);
    const hash = this.hash(key);
    // eslint-disable-next-line no-bitwise
    const hashtableIndex = hash & 0xFFn;

    this.encoding.keyLengthEncoding.write(record, key.length, 0);
    this.encoding.dataLengthEncoding.write(record, data.length, this.encoding.keyLengthEncoding.size);
    key.copy(record, this.encoding.recordHeaderSize);
    data.copy(record, this.encoding.recordHeaderSize + key.length);

    // console.log(`*********** writing key ${key} data ${data} record ${record.toString('hex')} to file position 0x${this.filePosition.toString(16)}`);
    const drainPromise = this.recordStream.write(record) ? null : new Promise((resolve, reject) => {
      this._recordStreamDrainWaiters.add({ resolve, reject });
      // We don't wait for the entire flush
    });


    let hashtable = this.hashtables[hashtableIndex];
    if (!hashtable) {
      hashtable = [];
      this.hashtables[hashtableIndex] = hashtable;
    }

    hashtable.push({ hash, position: this.filePosition });

    this.filePosition += record.length;

    if (drainPromise) {
      await drainPromise;
      if (this.recordStreamError) {
        throw this.recordStreamError; // check if was an error during the writing
      }
    }
  }

  async close() {
    await new Promise((resolve, reject) => {
      let alreadyFinished = false;
      const onFinish = () => {
        if (alreadyFinished) {
          return;
        }
        alreadyFinished = true;
        this.recordStream.removeListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        if (alreadyFinished) {
          return;
        }
        alreadyFinished = true;
        this.recordStream.removeListener('finish', onFinish);
        reject(err);
      };
      if (this.recordStreamError) {
        reject(this.recordStreamError); // check if was an error during the writing
        return;
      }
      // Let's replace the error handler
      this.recordStream.once('finish', onFinish);
      this.recordStream.once('error', onError);
      this.recordStream.removeListener('error', this._recordStreamErrorSaver);
      this.recordStream.end();
    });
    this.recordStream.removeListener('drain', this._recordStreamDrainCaller);

    await new Promise((resolve, reject) => {
      let alreadyFinished = false;
      const onOpen = () => {
        if (alreadyFinished) {
          return;
        }

        const { length } = this.hashtables;
        for (let i = 0; i < length; i += 1) {
          const hashtable = this.hashtables[i] || [];
          const buffer = this.#getBufferForHashtable(hashtable);

          if (buffer.length > 0) {
            // console.log(`*********** writing the buffer at 0x${this.filePosition.toString(16)}`);
            this.hashtableStream.write(buffer);
          }

          this.header[i] = {
            position: this.filePosition,
            slots: hashtable.length * 2,
          };

          this.filePosition += buffer.length;

          // free the hashtable
          this.hashtables[i] = null;
        }
        this.hashtableStream.once('finish', onFinish);
        this.hashtableStream.end();
      };
      const onFinish = () => {
        if (alreadyFinished) {
          return;
        }
        alreadyFinished = true;
        this.hashtableStream.removeListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        if (alreadyFinished) {
          return;
        }
        alreadyFinished = true;
        this.hashtableStream.removeListener('open', onOpen);
        this.hashtableStream.removeListener('finish', onFinish);
        reject(err);
      };
      // hashtableStream could be local but we save it on this for debugging
      // console.log(`*********** opening file for hashtable writing: ${this.file} at start 0x${self.filePosition.toString(16)}`);
      this.hashtableStream = fs.createWriteStream(this.file, { start: this.filePosition, flags: 'r+' });
      this.hashtableStream.once('open', onOpen);
      this.hashtableStream.once('error', onError);
    });

    /*
    * Allocated buffer containing the binary representation of a CDB
    * header. The header contains 255 (count, position) pairs representing the
    * number of slots and position of the hashtables.
    */
    const buffer = Buffer.alloc(this.encoding.headerSize);
    let bufferPosition = 0;

    for (let i = 0; i < this.encoding.tableSize; i += 1) {
      const { position, slots } = this.header[i];

      this.encoding.pointerEncoding.write(buffer, position, bufferPosition);
      this.encoding.slotIndexEncoding.write(buffer, slots, bufferPosition + this.encoding.pointerEncoding.size); // 4 bytes per int
      bufferPosition += this.encoding.mainPairSize;
    }

    await asyncFs.writeFile(this.file, buffer, { flag: 'r+' });
  }
}

module.exports = Writable;
