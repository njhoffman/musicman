'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('fs');
const { MAX_LENGTH } = require('buffer').constants;
// const Uint64BE = require('int64-buffer').Uint64BE;
const iconv = require('iconv-lite');
const frame_definitions_1 = require('./frame-definitions');
/*
 **  Used specification: http://id3.org/id3v2.3.0
 */
const DEFAULT_PADDING_SIZE = 2048; // Padding sized used when file has no tag, or new tag won't fit
/*
 **  Officially available types of the picture frame
 */
const APICTypes = [
  'other',
  'file icon',
  'other file icon',
  'front cover',
  'back cover',
  'leaflet page',
  'media',
  'lead artist',
  'artist',
  'conductor',
  'band',
  'composer',
  'lyricist',
  'recording location',
  'during recording',
  'during performance',
  'video screen capture',
  'a bright coloured fish',
  'illustration',
  'band logotype',
  'publisher logotype'
];
const multiValueSplitter = '#BREAK_HERE#';

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

class NodeID3 {
  constructor() {
    /*
     **  List of non-text frames which follow their specific specification
     **  name    => Frame ID
     **  create  => function to create the frame
     **  read    => function to read the frame
     */
    this.SFrames = {
      comment: {
        name: 'COMM',
        create: NodeID3.prototype.createCommentFrame.bind(this),
        read: NodeID3.prototype.readCommentFrame.bind(this)
      },
      image: {
        name: 'APIC',
        create: NodeID3.prototype.createPictureFrame.bind(this),
        read: NodeID3.prototype.readPictureFrame.bind(this)
      },
      unsynchronisedLyrics: {
        name: 'USLT',
        create: NodeID3.prototype.createUnsynchronisedLyricsFrame.bind(this),
        read: NodeID3.prototype.readUnsynchronisedLyricsFrame.bind(this)
      },
      userDefined: {
        name: 'TXXX',
        create: NodeID3.prototype.createUserDefinedFrame.bind(this),
        read: NodeID3.prototype.readUserDefinedFrame.bind(this)
      }
    };
  }
  getVersionedFrameDefinitions(version) {
    if (version === frame_definitions_1.TagVersion.v23) {
      return frame_definitions_1.ID3v23Frames;
    } else {
      return frame_definitions_1.ID3v24Frames;
    }
  }
  /*
   **  Write passed tags to a file/buffer @ filebuffer
   **  tags        => Object
   **  filebuffer  => String || Buffer
   **  fn          => Function (for asynchronous usage)
   */
  write(tags, filebuffer, fn) {
    console.log('WRITING TAGS', tags);
    const completeTag = this.create(tags) || new Buffer(0);
    const header = new Buffer(25);
    if (filebuffer instanceof Buffer) {
      console.log('\n\n1\n');
      filebuffer = this.removeTagsFromBuffer(filebuffer) || filebuffer;
      const completeBuffer = Buffer.concat([completeTag, filebuffer]);
      if (fn && typeof fn === 'function') {
        fn(null, completeBuffer);
        return;
      } else {
        return completeBuffer;
      }
    }
    if (fn && typeof fn === 'function') {
      console.log('\n\n2\n');
      // async
      try {
        fs.readFile(filebuffer, (err, data) => {
          if (err) {
            fn(err);
            return;
          }
          data = this.removeTagsFromBuffer(data) || data;
          const rewriteFile = Buffer.concat([completeTag, data]);
          fs.writeFile(filebuffer, rewriteFile, 'binary', error => fn(error));
        });
      } catch (err) {
        fn(err);
      }
    } else {
      console.log('\n\n3\n');
      // sync
      try {
        const fd = fs.openSync(filebuffer, 'r+');
        if (!fd) {
          return false;
        }
        fs.readSync(fd, header, 0, 25, 0);
        const fileHeaderSize = this.getTagHeaderSize(header);
        const updatedTagHeaderSize = this.getTagHeaderSize(completeTag);
        if (fileHeaderSize >= updatedTagHeaderSize && fileHeaderSize - 10240 <= updatedTagHeaderSize) {
          // has padding to fit full tag, and padding is 10k or less
          const paddingSize = fileHeaderSize - updatedTagHeaderSize;
          const padding = this.getPaddingBuffer(paddingSize);
          this.writeTagHeaderSize(fileHeaderSize, completeTag);
          const writeTag = Buffer.concat([completeTag, padding]);
          fs.writeSync(fd, writeTag, 0, fileHeaderSize);
        } else {
          // not enough room for tag. Add tag, and 2k of padding
          let data = fs.readFileSync(filebuffer);
          data = this.removeTagsFromBuffer(data) || data;
          const padding = this.getPaddingBuffer(DEFAULT_PADDING_SIZE);
          this.writeTagHeaderSize(this.getTagHeaderSize(completeTag) + DEFAULT_PADDING_SIZE, completeTag);
          const rewriteFile = Buffer.concat([completeTag, padding, data]);
          fs.writeFileSync(filebuffer, rewriteFile, 'binary');
        }
        fs.closeSync(fd);
        return true;
      } catch (err) {
        return err;
      }
    }
  }
  getPaddingBuffer(size) {
    const padding = new Buffer(size);
    padding.fill(0);
    return padding;
  }
  writeTagHeaderSize(size, tag) {
    //  ID3 header size uses only 7 bits of a byte, bit shift is needed
    const encodedSize = this.encodeSize(size);
    //  Write bytes to ID3 frame header, which is the first frame
    tag.writeUInt8(encodedSize[0], 6);
    tag.writeUInt8(encodedSize[1], 7);
    tag.writeUInt8(encodedSize[2], 8);
    tag.writeUInt8(encodedSize[3], 9);
  }
  create(tags, fn) {
    const frames = [];
    const TFrames = this.getVersionedFrameDefinitions(frame_definitions_1.TagVersion.v24);
    //  Push a header for the ID3-Frame
    frames.push(this.createTagHeader());
    const tagNames = Object.keys(tags);
    tagNames.forEach(tag => {
      //  Check if passed tag is text frame (Alias or ID)
      let frame;
      if (
        TFrames[tag] ||
        Object.keys(TFrames)
          .map(i => TFrames[i])
          .indexOf(tag) !== -1
      ) {
        const specName = TFrames[tag] || tag;
        frame = this.createTextFrame(specName, tags[tag]);
      } else if (this.SFrames[tag]) {
        //  Check if Alias of special frame
        const createFrameFunction = this.SFrames[tag].create;
        frame = createFrameFunction(tags[tag]);
      } else {
        const idx = Object.keys(this.SFrames)
          .map(i => this.SFrames[i].name)
          .indexOf(tag);
        if (idx !== -1) {
          //  if frameID of special frame
          //  get create function from special frames where tag ID is found at this.SFrames[index].name
          const createFrameFunction = this.SFrames[Object.keys(this.SFrames)[idx]].create;
          frame = createFrameFunction(tags[tag]);
          if (Array.isArray(frame)) {
            frame.forEach(f => frames.push(f));
            frame = null; // already added, so don't add below
          }
        }
      }
      if (frame instanceof Buffer) {
        frames.push(frame);
      }
    });
    //  Calculate frame size of ID3 body to insert into header
    let totalSize = 0;
    frames.forEach(frame => {
      totalSize += frame.length;
    });
    //  Don't count ID3 header itself
    totalSize -= 10;
    this.writeTagHeaderSize(totalSize, frames[0]);
    if (fn && typeof fn === 'function') {
      fn(Buffer.concat(frames));
    } else {
      return Buffer.concat(frames);
    }
  }
  /*
   **  Read ID3-Tags from passed buffer/filepath
   **  filebuffer  => Buffer || String
   **  options     => Object
   **  fn          => function (for asynchronous usage)
   */
  read(filebuffer, options, fn) {
    if (!options || typeof options === 'function') {
      fn = fn || options;
      options = {};
    }
    if (!fn || typeof fn !== 'function') {
      if (typeof filebuffer === 'string' || filebuffer instanceof String) {
        filebuffer = fs.readFileSync(filebuffer.toString());
      }
      return this.getTagsFromBuffer(filebuffer);
    } else {
      if (typeof filebuffer === 'string' || filebuffer instanceof String) {
        fs.readFile(filebuffer.toString(), (err, data) => {
          if (err && fn) {
            fn(err, null);
          } else {
            const tags = this.getTagsFromBuffer(data);
            if (fn) {
              fn(null, tags);
            }
          }
        });
      }
    }
  }
  /*
   **  Update ID3-Tags from passed buffer/filepath
   **  tags        => Object
   **  filebuffer  => Buffer || String
   **  fn          => function (for asynchronous usage)
   */
  update(tags, filebuffer, fn) {
    const rawTags = {};
    const TFrames = this.getVersionedFrameDefinitions(frame_definitions_1.TagVersion.v24); // TODO: this seems bad to assume
    Object.keys(tags).map(tagKey => {
      //  if js name passed (TF)
      if (TFrames[tagKey]) {
        rawTags[TFrames[tagKey]] = tags[tagKey];
        //  if js name passed (SF)
      } else if (this.SFrames[tagKey]) {
        rawTags[this.SFrames[tagKey].name] = tags[tagKey];
        //  if raw name passed (TF)
      } else if (
        Object.keys(TFrames)
          .map(i => TFrames[i])
          .indexOf(tagKey) !== -1
      ) {
        rawTags[tagKey] = tags[tagKey];
        //  if raw name passed (SF)
      } else if (
        Object.keys(this.SFrames)
          .map(i => this.SFrames[i])
          .map(x => x.name)
          .indexOf(tagKey) !== -1
      ) {
        rawTags[tagKey] = tags[tagKey];
      }
    });
    if (!fn || typeof fn !== 'function') {
      let currentTags = this.read(filebuffer);
      currentTags = currentTags.raw || {};
      //  update current tags with new or keep them
      Object.keys(rawTags).map(tag => {
        currentTags[tag] = rawTags[tag];
      });
      return this.write(currentTags, filebuffer);
    } else {
      this.read(filebuffer, (err, currentTags) => {
        if (err) {
          fn(err);
          return;
        }
        currentTags = currentTags.raw || {};
        //  update current tags with new or keep them
        Object.keys(rawTags).map(tag => {
          currentTags[tag] = rawTags[tag];
        });
        this.write(currentTags, filebuffer, fn);
      });
    }
  }
  /*
   **  Read ID3-Tags from passed buffer
   **  filebuffer  => Buffer
   **  options     => Object
   */
  getTagsFromBuffer(filebuffer) {
    const framePosition = this.getFramePosition(filebuffer);
    if (framePosition === -1) {
      return false;
    }
    const tempBuffer = new Buffer(filebuffer.toString('hex', framePosition, framePosition + 10), 'hex');
    const version = this.getTagVersion(tempBuffer);
    if (version === frame_definitions_1.TagVersion.unknown) {
      return false; // bad tag
    }
    const TFrames = this.getVersionedFrameDefinitions(version);
    const frameSize = this.getTagsSize(tempBuffer) + 10;
    const ID3FrameBody = new Buffer(frameSize - 10 + 1);
    filebuffer.copy(ID3FrameBody, 0, framePosition + 10);
    //  Now, get frame for frame by given size to support unkown tags etc.
    const frames = [];
    const tags = {
      raw: {}
    };
    let currentPosition = 0;
    while (currentPosition < frameSize - 10 && ID3FrameBody[currentPosition] !== 0x00) {
      const bodyFrameHeader = new Buffer(10);
      ID3FrameBody.copy(bodyFrameHeader, 0, currentPosition);
      const unsynchronized = !!(bodyFrameHeader[9] & (1 << 1));

      // TODO: framesize exceeding int range for >20 mb songs, i.e. Pink Floyd dogs)
      let bodyFrameSize = this.getFrameSize(bodyFrameHeader, 4, unsynchronized);

      if (bodyFrameSize > MAX_LENGTH) {
        const errorMsg = `Frame size ${numberWithCommas(
          bodyFrameSize
        )} larger than buffer max length ${numberWithCommas(MAX_LENGTH)}`;
        console.warn(errorMsg);
        break;
      }

      const bodyFrameBuffer = new Buffer(bodyFrameSize);
      ID3FrameBody.copy(bodyFrameBuffer, 0, currentPosition + 10);
      //  Size of sub frame + its header
      currentPosition += bodyFrameSize + 10;
      frames.push({
        name: bodyFrameHeader.toString('utf8', 0, 4),
        body: bodyFrameBuffer,
        unsynchronized,
        dataLengthIndicator: unsynchronized
      });
    }
    frames.forEach(frame => {
      //  Check first character if frame is text frame
      if (frame.name[0] === 'T' && frame.name !== 'TXXX') {
        //  Decode body
        let decoded;
        let separator = new RegExp('\0', 'g');
        decoded = iconv
          .decode(frame.body.slice(1), this.getEncodingName(frame.body))
          .replace(separator, multiValueSplitter);
        decoded = this.splitMultiValues(decoded);
        tags.raw[frame.name] = decoded;
        let found = false;
        Object.keys(TFrames).map(key => {
          if (TFrames[key].key === frame.name) {
            if (
              version === frame_definitions_1.TagVersion.v23 &&
              TFrames[key].multiValueSeparator &&
              typeof decoded === 'string'
            ) {
              separator = new RegExp(TFrames[key].multiValueSeparator, 'g');
              decoded = decoded.replace(separator, multiValueSplitter);
              decoded = this.splitMultiValues(decoded);
            }
            tags[key] = decoded;
            found = true;
          }
        });
        if (!found && frame_definitions_1.LegacyFramesRemapped[frame.name] !== undefined) {
          tags[frame_definitions_1.LegacyFramesRemapped[frame.name]] = decoded;
        }
      } else {
        //  Check if non-text frame is supported
        Object.keys(this.SFrames).map(key => {
          if (this.SFrames[key].name === frame.name) {
            const decoded = this.SFrames[key].read(frame.body, frame.unsynchronized, frame.dataLengthIndicator);
            if (frame.name !== 'TXXX') {
              tags.raw[frame.name] = decoded;
              tags[key] = decoded;
            } else {
              if (!tags.raw[frame.name]) {
                tags.raw[frame.name] = {};
                tags[key] = {};
              }
              if (tags[key][decoded.description]) {
                // v2.3 convention seems to be multiple TXXX with same description for multiValue
                decoded.values = Array.prototype.concat(tags[key][decoded.description], decoded.values);
              }
              tags.raw[frame.name][decoded.description] = decoded.values;
              tags[key][decoded.description] = decoded.values;
            }
          }
        });
      }
    });
    return tags;
  }
  /*
   **  Get position of ID3-Frame, returns -1 if not found
   **  buffer  => Buffer
   */
  getFramePosition(buffer) {
    const framePosition = String.prototype.indexOf.call(buffer, new Buffer('ID3'));
    if (framePosition === -1 || framePosition > 20) {
      return -1;
    } else {
      return framePosition;
    }
  }
  getTagVersion(buffer) {
    const framePosition = String.prototype.indexOf.call(buffer, new Buffer('ID3'));
    if (framePosition === -1 || framePosition > 20) {
      return frame_definitions_1.TagVersion.unknown;
    } else {
      if (buffer[framePosition + 3] === 3) {
        return frame_definitions_1.TagVersion.v23;
      } else if (buffer[framePosition + 3] === 4) {
        return frame_definitions_1.TagVersion.v24;
      } else {
        return frame_definitions_1.TagVersion.unknown;
      }
    }
  }
  /*
   **  Get size of frame from header
   **  buffer  => Buffer/Array (header)
   **  decode  => Boolean
   */
  getFrameSize(buffer, offset, decode) {
    if (decode) {
      return this.decodeSize(new Buffer([buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]]));
    } else {
      return new Buffer([buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]]).readUInt32BE(
        0,
        4
      );
    }
  }
  getTagsSize(buffer) {
    return this.getFrameSize(buffer, 6, true);
  }
  getTagHeaderSize(data) {
    const framePosition = this.getFramePosition(data);
    const hSize = new Buffer([
      data[framePosition + 6],
      data[framePosition + 7],
      data[framePosition + 8],
      data[framePosition + 9]
    ]);
    if ((hSize[0] | hSize[1] | hSize[2] | hSize[3]) & 0x80) {
      //  Invalid tag size (msb not 0)
      return -1;
    }
    return this.decodeSize(hSize);
  }
  /*
   **  Checks and removes already written ID3-Frames from a buffer
   **  data => buffer
   */
  removeTagsFromBuffer(data) {
    const framePosition = this.getFramePosition(data);
    if (framePosition === -1) {
      return data;
    }
    const size = this.getTagHeaderSize(data);
    if (size < 0) {
      return false;
    }
    return data.slice(framePosition + size + 10);
  }
  /*
   **  Checks and removes already written ID3-Frames from a file
   **  data => buffer
   */
  removeTags(filepath, fn) {
    if (!fn || typeof fn !== 'function') {
      let data;
      try {
        data = fs.readFileSync(filepath);
      } catch (e) {
        return e;
      }
      const newData = this.removeTagsFromBuffer(data);
      if (!newData) {
        return false;
      }
      try {
        fs.writeFileSync(filepath, newData, 'binary');
      } catch (e) {
        return e;
      }
      return true;
    } else {
      fs.readFile(filepath, (err, data) => {
        if (err) {
          fn(err);
        }
        const newData = this.removeTagsFromBuffer(data);
        if (!newData) {
          fn(err);
          return;
        }
        fs.writeFile(filepath, newData, 'binary', error => {
          if (error) {
            fn(error);
          } else {
            fn(false);
          }
        });
      });
    }
  }
  /*
   **  This function ensures that the msb of each byte is 0
   **  totalSize => int
   */
  encodeSize(totalSize) {
    const byte3 = totalSize & 0x7f;
    const byte2 = (totalSize >> 7) & 0x7f;
    const byte1 = (totalSize >> 14) & 0x7f;
    const byte0 = (totalSize >> 21) & 0x7f;
    return [byte0, byte1, byte2, byte3];
  }
  /*
   **  This function decodes the 7-bit size structure
   **  hSize => int
   */
  decodeSize(hSize) {
    return (hSize[0] << 21) + (hSize[1] << 14) + (hSize[2] << 7) + hSize[3];
  }
  /*
   **  Create header for ID3-Frame v2.4.0
   */
  createTagHeader() {
    const header = new Buffer(10);
    header.fill(0);
    header.write('ID3', 0); // File identifier
    header.writeUInt16BE(0x0400, 3); // Version 2.4.0  --  04 00
    header.writeUInt16BE(0x0000, 5); // Flags 00
    // Last 4 bytes are used for header size, but have to be inserted later,
    // because at this point, its size is not clear.
    return header;
  }
  /*
   ** Create text frame
   ** frameId   =>  string (ID)
   ** textValue =>  string or array of strings (body)
   */
  createTextFrame(frameId, textValue) {
    let encoded = new Buffer(0);
    if (!frameId || !textValue) {
      return null;
    }
    const seperator = new Buffer(1);
    seperator.fill(0);
    if (Array.isArray(textValue)) {
      textValue.forEach(t => {
        encoded = Buffer.concat([encoded, iconv.encode(t, 'utf8'), seperator]);
      });
    } else {
      encoded = iconv.encode(textValue, 'utf8');
      encoded = Buffer.concat([encoded, seperator]);
    }
    const buffer = new Buffer(10);
    buffer.fill(0);
    buffer.write(frameId, 0); //  ID of the specified frame
    buffer.writeUInt32BE(encoded.length + 1, 4); //  Size of frame (string length + encoding byte)
    const encBuffer = new Buffer(1); //  Encoding (now using UTF-8)
    encBuffer.fill(this.getEncodingByte('utf8'));
    // const contentBuffer = new Buffer(encoded.toString(), 'binary'); //  Text -> Binary encoding for UTF-16 w/ BOM
    return Buffer.concat([buffer, encBuffer, encoded]);
  }
  /*
   **  data => string || buffer
   */
  createPictureFrame(data) {
    try {
      if (data && data.imageBuffer && data.imageBuffer instanceof Buffer === true) {
        data = data.imageBuffer;
      }
      const apicData =
        data instanceof Buffer === true ? new Buffer(data) : new Buffer(fs.readFileSync(data, 'binary'), 'binary');
      const bHeader = new Buffer(10);
      bHeader.fill(0);
      bHeader.write('APIC', 0);
      let mimeType = 'image/png';
      if (apicData[0] === 0xff && apicData[1] === 0xd8 && apicData[2] === 0xff) {
        mimeType = 'image/jpeg';
      }
      const bContent = new Buffer(mimeType.length + 4);
      bContent.fill(0);
      bContent[mimeType.length + 2] = 0x03; //  Front cover
      bContent.write(mimeType, 1);
      bHeader.writeUInt32BE(apicData.length + bContent.length, 4); //  Size of frame
      return Buffer.concat([bHeader, bContent, apicData]);
    } catch (e) {
      return e;
    }
  }
  /*
   **  data => buffer
   */
  readPictureFrame(APICFrame, unsynchronized, dataLengthIndicator) {
    const picture = {};
    const firstByte = dataLengthIndicator ? 5 : 1; // really byte after encoding byte
    const APICMimeType = APICFrame.toString('ascii').substring(firstByte, APICFrame.indexOf(0x00, firstByte));
    if (APICMimeType === 'image/jpeg') {
      picture.mime = 'jpeg';
    } else if (APICMimeType === 'image/png') {
      picture.mime = 'png';
    }
    picture.type = {
      id: APICFrame[APICFrame.indexOf(0x00, firstByte) + 1],
      name: APICTypes[APICFrame[APICFrame.indexOf(0x00, firstByte) + 1]]
    };
    let descEnd;
    if (APICFrame[firstByte - 1] === 0x00) {
      picture.description =
        iconv.decode(
          APICFrame.slice(
            APICFrame.indexOf(0x00, firstByte) + 2,
            APICFrame.indexOf(0x00, APICFrame.indexOf(0x00, firstByte) + 2)
          ),
          'ISO-8859-1'
        ) || undefined;
      descEnd = APICFrame.indexOf(0x00, APICFrame.indexOf(0x00, firstByte) + 2);
    } else if (APICFrame[firstByte - 1] === 0x01) {
      const descOffset = APICFrame.indexOf(0x00, 1) + 2;
      const desc = APICFrame.slice(descOffset);
      const descFound = desc.indexOf('0000', 0, 'hex');
      descEnd = descOffset + descFound + 2;
      if (descFound !== -1) {
        picture.description = iconv.decode(desc.slice(0, descFound + 2), 'utf16') || undefined;
      }
    }
    if (descEnd) {
      picture.imageBuffer = APICFrame.slice(descEnd + 1);
    } else {
      picture.imageBuffer = APICFrame.slice(APICFrame.indexOf(0x00, firstByte) + 2);
    }
    if (unsynchronized) {
      const buf = [];
      for (let i = 0; i < picture.imageBuffer.length; i++) {
        buf.push(picture.imageBuffer[i]);
        if (picture.imageBuffer[i] === 255 && picture.imageBuffer[i + 1] === 0) {
          i++;
        }
      }
      picture.imageBuffer = new Buffer(buf);
    }
    return picture;
  }
  getEncodingByte(encoding) {
    if (!encoding || encoding === 'ISO-8859-1') {
      return 0x00;
    } else if (encoding === 'utf8') {
      return 0x03;
    } else if (typeof encoding === 'number') {
      return encoding;
    } else {
      return encoding[0];
    }
  }
  getEncodingName(data) {
    switch (this.getEncodingByte(data)) {
      case 0x00:
        return 'ISO-8859-1'; // Latin-1
      case 0x01:
        return 'utf16';
      case 0x02:
        return 'UTF-16BE';
      case 0x03:
      default:
        return 'utf8';
    }
  }
  getTerminationCount(data) {
    const encoding = this.getEncodingByte(data);
    if (encoding === 0x00 || encoding === 0x03) {
      return 1;
    } else {
      return 2;
    }
  }
  createTextEncoding(encoding) {
    const buffer = new Buffer(1);
    buffer[0] = encoding; // this.getEncodingByte(encoding)
    return buffer;
  }
  createLanguage(language) {
    if (!language) {
      language = 'eng';
    } else if (language.length > 3) {
      language = language.substring(0, 3);
    }
    return new Buffer(language);
  }
  createContentDescriptor(description, encoding, terminated) {
    if (!description) {
      description = terminated ? iconv.encode('\0', this.getEncodingName(encoding)) : new Buffer(0);
      return description;
    }
    if (typeof description === 'string') {
      description = iconv.encode(description, this.getEncodingName(encoding));
    } else {
      description = iconv.encode(description.toString(), this.getEncodingName(encoding));
    }
    return terminated
      ? Buffer.concat([description, new Buffer(this.getTerminationCount(encoding)).fill(0x00)])
      : description;
  }
  createText(text, encoding, terminated) {
    if (!text) {
      text = '';
    }
    const textBuffer = iconv.encode(text, this.getEncodingName(encoding));
    return terminated
      ? Buffer.concat([textBuffer, new Buffer(this.getTerminationCount(encoding)).fill(0x00)])
      : textBuffer;
  }
  /*
   **  comment => object {
   **      language:   string (3 characters),
   **      text:       string
   **      shortText:  string
   **  }
   **/
  createCommentFrame(comment) {
    comment = comment || { language: '', shortText: '', text: '' };
    if (!comment.text) {
      return null;
    }
    // Create frame header
    const buffer = new Buffer(10);
    buffer.fill(0);
    buffer.write('COMM', 0); //  Write header ID
    const encodingBuffer = this.createTextEncoding(0x01);
    const languageBuffer = this.createLanguage(comment.language);
    const descriptorBuffer = this.createContentDescriptor(comment.shortText, 0x01, true);
    const textBuffer = this.createText(comment.text, 0x01, false);
    buffer.writeUInt32BE(
      encodingBuffer.length + languageBuffer.length + descriptorBuffer.length + textBuffer.length,
      4
    );
    return Buffer.concat([buffer, encodingBuffer, languageBuffer, descriptorBuffer, textBuffer]);
  }
  /*
   **  frame   => Buffer
   */
  readCommentFrame(frame) {
    let tags = {};
    if (!frame) {
      return tags;
    }
    if (frame[0] === 0x00) {
      tags = {
        language: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(1, 4)
          .replace(/\0/g, ''),
        shortText: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(4, frame.indexOf(0x00, 1))
          .replace(/\0/g, ''),
        text: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(frame.indexOf(0x00, 1) + 1)
          .replace(/\0/g, '')
      };
    } else if (frame[0] === 0x01) {
      let descriptorEscape = 0;
      while (
        (frame[descriptorEscape] !== undefined && frame[descriptorEscape] !== 0x00) ||
        frame[descriptorEscape + 1] !== 0x00 ||
        frame[descriptorEscape + 2] === 0x00
      ) {
        descriptorEscape++;
      }
      if (frame[descriptorEscape] === undefined) {
        return tags;
      }
      const shortText = frame.slice(4, descriptorEscape);
      const text = frame.slice(descriptorEscape + 2);
      tags = {
        language: frame
          .toString()
          .substring(1, 4)
          .replace(/\0/g, ''),
        shortText: iconv.decode(shortText, 'utf16').replace(/\0/g, ''),
        text: iconv.decode(text, 'utf16').replace(/\0/g, '')
      };
    }
    return tags;
  }
  /*
   **  unsynchronisedLyrics => object {
   **      language:   string (3 characters),
   **      text:       string
   **      shortText:  string
   **  }
   **/
  createUnsynchronisedLyricsFrame(unsynchronisedLyrics) {
    unsynchronisedLyrics = unsynchronisedLyrics || {};
    if (typeof unsynchronisedLyrics === 'string' || unsynchronisedLyrics instanceof String) {
      unsynchronisedLyrics = {
        language: 'eng',
        text: unsynchronisedLyrics
      };
    }
    if (!unsynchronisedLyrics.text) {
      return null;
    }
    // Create frame header
    const buffer = new Buffer(10);
    buffer.fill(0);
    buffer.write('USLT', 0); //  Write header ID
    const encodingBuffer = this.createTextEncoding(0x01);
    const languageBuffer = this.createLanguage(unsynchronisedLyrics.language);
    const descriptorBuffer = this.createContentDescriptor(unsynchronisedLyrics.shortText, 0x01, true);
    const textBuffer = this.createText(unsynchronisedLyrics.text, 0x01, false);
    buffer.writeUInt32BE(
      encodingBuffer.length + languageBuffer.length + descriptorBuffer.length + textBuffer.length,
      4
    );
    return Buffer.concat([buffer, encodingBuffer, languageBuffer, descriptorBuffer, textBuffer]);
  }
  /*
   **  frame   => Buffer
   */
  readUnsynchronisedLyricsFrame(frame) {
    let tags = {};
    if (!frame) {
      return tags;
    }
    if (frame[0] === 0x00) {
      tags = {
        language: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(1, 4)
          .replace(/\0/g, ''),
        shortText: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(4, frame.indexOf(0x00, 1))
          .replace(/\0/g, ''),
        text: iconv
          .decode(frame, 'ISO-8859-1')
          .substring(frame.indexOf(0x00, 1) + 1)
          .replace(/\0/g, '')
      };
    } else if (frame[0] === 0x01) {
      let descriptorEscape = 0;
      while (
        (frame[descriptorEscape] !== undefined && frame[descriptorEscape] !== 0x00) ||
        frame[descriptorEscape + 1] !== 0x00 ||
        frame[descriptorEscape + 2] === 0x00
      ) {
        descriptorEscape++;
      }
      if (frame[descriptorEscape] === undefined) {
        return tags;
      }
      const shortText = frame.slice(4, descriptorEscape);
      const text = frame.slice(descriptorEscape + 2);
      tags = {
        language: frame
          .toString()
          .substring(1, 4)
          .replace(/\0/g, ''),
        shortText: iconv.decode(shortText, 'utf16').replace(/\0/g, ''),
        text: iconv.decode(text, 'utf16').replace(/\0/g, '')
      };
    }
    return tags;
  }
  splitMultiValues(valueString) {
    let vals = valueString;
    if (valueString.indexOf(multiValueSplitter)) {
      vals = valueString.split(multiValueSplitter).filter(v => v.length);
      if (vals.length === 1) {
        // don't store single values as an array
        vals = vals[0];
      }
    }
    return vals;
  }
  readUserDefinedFrame(frame) {
    const tags = {};
    if (!frame) {
      return tags;
    }
    const decodedFrame = iconv.decode(frame.slice(1), this.getEncodingName(frame));
    let values;
    if (this.getEncodingName(frame) === 'utf16' || this.getEncodingName(frame) === 'UTF-16BE') {
      const nullBuffer = new Buffer([0x00, 0x00]);
      const descriptionEnd = frame.indexOf(nullBuffer, 1) / 2;
      tags.description = decodedFrame.substring(0, descriptionEnd).replace(/\0/g, '');
      values = decodedFrame.substring(descriptionEnd + 1).replace(/\0/g, multiValueSplitter);
    } else {
      tags.description = decodedFrame.substring(0, frame.indexOf(0x00, 1)).replace(/\0/g, '');
      values = decodedFrame.substring(frame.indexOf(0x00, 1)).replace(/\0/g, multiValueSplitter);
    }
    tags.values = this.splitMultiValues(values);
    return tags;
  }
  /**
   * Create one or multiple userDefined TXXX frames.
   *
   * @param userProps object containing key/value properties, each will get it's own TXXX frame
   */
  createUserDefinedFrame(userProps) {
    const frames = [];
    Object.keys(userProps).forEach(desc => {
      // TXXX frame is identical to a multi-value frame just that the first value is the description
      frames.push(this.createTextFrame('TXXX', Array.prototype.concat(desc, userProps[desc])));
    });
    return frames;
  }
}
exports.NodeID3 = NodeID3;
module.exports = new NodeID3();
//# sourceMappingURL=index.js.map
