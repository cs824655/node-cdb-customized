'use strict';

const events = require('events');
const fs= require('fs');
const util   = require('util');
const _ = require('./cdb-util');
const HEADER_SIZE = 2048;
const TABLE_SIZE = 256;

// Writable CDB definition
function writable(file) {
  this.file = file;
  this.filePosition = 0;
  
  this.header = new Array(TABLE_SIZE);
  this.hashtables = new Array(TABLE_SIZE);
  
  this.recordStream = null;
  this.hashtableStream = null;
};

// extend EventEmitter for emit()
util.inherits(writable, events.EventEmitter);

writable.prototype.open = function(cb) {
  const recordStream = fs.createWriteStream(this.file, {start: HEADER_SIZE});
  const callback = cb || function() {};
  const self = this;
  
  function fileOpened() {
    self.recordStream = recordStream;
    self.filePosition = HEADER_SIZE;
    
    recordStream.on('drain', function echoDrain() {
      self.emit('drain');
    });
    
    recordStream.removeListener('error', error);
    
    self.emit('open');
    callback(null, self);
  }
  
  function error(err) {
    recordStream.removeListener('open', fileOpened);
    
    self.emit('error', err);
    callback(err);
  }
  
  recordStream.once('open', fileOpened);
  recordStream.once('error', error);
};

writable.prototype.put = function(key, data, callback) {
  const keyLength = Buffer.byteLength(key);
  const dataLength = Buffer.byteLength(data);
  const record = new Buffer(8 + keyLength + dataLength);
  const hash = _.cdbHash(key);
  const hashtableIndex = hash & 255;
  const hashtable = this.hashtables[hashtableIndex];
  let okayToWrite;
  
  record.writeUInt32LE(keyLength, 0);
  record.writeUInt32LE(dataLength, 4);
  record.write(key, 8);
  record.write(data, 8 + keyLength);
  
  okayToWrite = this.recordStream.write(record, callback);
  
  if (!hashtable) {
    this.hashtables[hashtableIndex] = hashtable = [];
  }
  
  hashtable.push({hash: hash, position: this.filePosition});
  
  this.filePosition += record.length;
  
  return okayToWrite;
};

writable.prototype.close = function(cb) {
  const self = this;
  const callback = cb || function() {};
  
  this.recordStream.on('finish', openStreamForHashtable);
  this.recordStream.end();
  
  function openStreamForHashtable() {
    self.hashtableStream = fs.createWriteStream(self.file, {start: self.filePosition, flags: 'r+'});
    
    self.hashtableStream.once('open', writeHashtables);
    self.hashtableStream.once('error', error);
  }
  
  function writeHashtables() {
    const length = self.hashtables.length;
    
    for (let i = 0; i < length; i++) {
      const hashtable = self.hashtables[i] || [];
      const buffer = getBufferForHashtable(hashtable);
      
      self.hashtableStream.write(buffer);
      
      self.header[i] = {
        position: self.filePosition,
        slots: hashtable.length * 2
      };
      
      self.filePosition += buffer.length;
      
      // free the hashtable
      self.hashtables[i] = null;
    }
    
    self.hashtableStream.on('finish', writeHeader);
    self.hashtableStream.end();
  }
  
  function writeHeader() {
    const buffer = getBufferForHeader(self.header);
    
    fs.writeFile(self.file, buffer, {flag: 'r+'}, finished);
  }
  
  function finished() {
    self.emit('finish');
    callback();
  }
  
  function error(err) {
    self.emit('error', err);
    callback(err);
  }
};

// === Helper functions ===

/*
* Returns an allocated buffer containing the binary representation of a CDB
* hashtable. Hashtables are linearly probed, and use a load factor of 0.5, so
* the buffer will have 2n slots for n entries.
*
* Entries are made up of two 32-bit unsigned integers for a total of 8 bytes.
*/
function getBufferForHashtable(hashtable) {
  const length = hashtable.length;
  const slotCount = length * 2;
  const buffer = new Buffer(slotCount * 8);
  
  // zero out the buffer
  buffer.fill(0);
  
  for (let i = 0; i < length; i++) {
    const { hash, position } = hashtable[i];
    
    let slot = (hash >>> 8) % slotCount;
    let bufferPosition = slot * 8;
    
    // look for an empty slot
    while (buffer.readUInt32LE(bufferPosition) !== 0) {
      // this slot is occupied
      slot = (slot + 1) % slotCount;
      bufferPosition = slot * 8;
    }
    
    buffer.writeUInt32LE(hash, bufferPosition);
    buffer.writeUInt32LE(position, bufferPosition + 4);
  }
  
  return buffer;
}

/*
* Returns an allocated buffer containing the binary representation of a CDB
* header. The header contains 255 (count, position) pairs representing the
* number of slots and position of the hashtables.
*/
function getBufferForHeader(headerTable) {
  const buffer = new Buffer(HEADER_SIZE);
  let bufferPosition = 0;
  
  for (let i = 0; i < TABLE_SIZE; i++) {
    const { position, slots } = headerTable[i];
    
    buffer.writeUInt32LE(position, bufferPosition);
    buffer.writeUInt32LE(slots, bufferPosition + 4); // 4 bytes per int
    bufferPosition += 8;
  }
  
  return buffer;
}

module.exports = writable;
