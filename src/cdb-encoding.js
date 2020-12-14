const {
  uInt32LE,
  uInt64LE
} = require('./cdb-util');

class Encoding {  
  constructor(options) {
    this.pointerEncoding = options.isPointer32Bit ? uInt32LE : uInt64LE;
    this.slotIndexEncoding = options.isSlotIndex32Bit ? uInt32LE : uInt64LE;
    this.hashEncoding = options.isHash32Bit ? uInt32LE : uInt64LE;
    this.keyLengthEncoding = uInt32LE;
    this.dataLengthEncoding = uInt32LE;

    this.tableSize = 256;
    this.headerSize = this.tableSize * (this.pointerEncoding.size + this.slotIndexEncoding.size);
    this.mainPairSize = this.pointerEncoding.size + this.slotIndexEncoding.size;
    this.hashPairSize = this.hashEncoding.size + this.pointerEncoding.size;
    this.recordHeaderSize = this.keyLengthEncoding.size + this.dataLengthEncoding.size;
  }
}

module.exports = Encoding;