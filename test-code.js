// FIXME: Replace with URLSearchParams API.
const QueryString = function() {
  // Allows access to query parameters on the URL; e.g., given a URL like:
  //    http://<server>/my.html?test=123&bob=123
  // Parameters can then be accessed via QueryString.test or QueryString.bob.
  var params = {};
  // RegEx to split out values by & || ;.
  var r = /([^&;=]+)=?([^&;]*)/g;
  // Lambda function for decoding extracted match values. Replaces '+' with
  // space so decodeURIComponent functions properly.
  function d(s) { return decodeURIComponent(s.replace(/\+/g, ' ')); }
  var match;
  while (match = r.exec(window.location.search.substring(1)))
    params[d(match[1])] = d(match[2]);
  return params;
}();

const AV1_DATA = {
  src : 'av1.mp4',
  config : {
    codec : 'av01.0.04M.08',
    codedWidth : 320,
    codedHeight : 240,
    visibleRect : {left : 0, top : 0, width : 320, height : 240},
    displayWidth : 320,
    displayHeight : 240,
  },
  chunks : [
    {offset : 48, size : 1938}, {offset : 1986, size : 848},
    {offset : 2834, size : 3}, {offset : 2837, size : 47},
    {offset : 2884, size : 3}, {offset : 2887, size : 116},
    {offset : 3003, size : 3}, {offset : 3006, size : 51},
    {offset : 3057, size : 25}, {offset : 3082, size : 105}
  ]
};

const H264_AVC_DATA = {
  src : 'h264.mp4',
  config : {
    codec : 'avc1.64000b',
    description : {offset : 9490, size : 45},
    codedWidth : 320,
    codedHeight : 240,
    displayAspectWidth : 320,
    displayAspectHeight : 240,
  },
  chunks : [
    {offset : 48, size : 4140}, {offset : 4188, size : 604},
    {offset : 4792, size : 475}, {offset : 5267, size : 561},
    {offset : 5828, size : 587}, {offset : 6415, size : 519},
    {offset : 6934, size : 532}, {offset : 7466, size : 523},
    {offset : 7989, size : 454}, {offset : 8443, size : 528}
  ]
};

const VP9_DATA = {
  src : 'vp9.mp4',
  // TODO(sandersd): Verify that the file is actually level 1.
  config : {
    codec : 'vp09.00.10.08',
    codedWidth : 320,
    codedHeight : 240,
    displayAspectWidth : 320,
    displayAspectHeight : 240,
  },
  chunks : [
    {offset : 44, size : 3315}, {offset : 3359, size : 203},
    {offset : 3562, size : 245}, {offset : 3807, size : 172},
    {offset : 3979, size : 312}, {offset : 4291, size : 170},
    {offset : 4461, size : 195}, {offset : 4656, size : 181},
    {offset : 4837, size : 356}, {offset : 5193, size : 159}
  ]
};

// Create a view of an ArrayBuffer.
function view(buffer, {offset, size}) {
  return new Uint8Array(buffer, offset, size);
}

var CONFIG = null;
var CHUNK_DATA = null;
var CHUNKS = null;

const TESTDATA = {
  'av1' : AV1_DATA,
  'vp9' : VP9_DATA,
  'h264' : H264_AVC_DATA,
}[QueryString.codec ? QueryString.codec : 'h264'];

// Fetch the media data and prepare buffers.
fetch(TESTDATA.src)
    .then(response => { return response.arrayBuffer(); })
    .then(buf => {
      CONFIG = {...TESTDATA.config};

      if (QueryString.hw === 'require')
        CONFIG.hardwareAcceleration = 'require';
      else if (QueryString.hw === 'deny')
        CONFIG.hardwareAcceleration = 'deny';

      if (TESTDATA.config.description)
        CONFIG.description = view(buf, TESTDATA.config.description);

      if (typeof EncodedVideoChunk === 'undefined') {
        let status = document.getElementById('sStatus');
        status.style = 'color: red';
        status.innerText = 'Error, missing WebCodecs support.';
        document.getElementById('bStart').disabled = true;
        return;
      }

      CHUNK_DATA = TESTDATA.chunks.map((chunk, i) => view(buf, chunk));

      CHUNKS = CHUNK_DATA.map((data, i) => new EncodedVideoChunk({
                                type : i == 0 ? 'key' : 'delta',
                                timestamp : i,
                                duration : 1,
                                data
                              }));
    });

var startTime = null;
var outputs = 0;
var io_map = {};
var samples = [];
var stop = false;
var decoder = null;

const MAX_INDEX = 5000;
var index = 0;

function receiveOutput(output) {
  let elapsed = performance.now() - startTime;
  if (outputs++ == 0)
    document.getElementById('sTTFF').innerText = elapsed + ' ms';

  samples.push(performance.now() - io_map[output.timestamp]);
  if (samples.length > 25)
    samples.shift();
  let average = samples.reduce((a, b) => a + b) / samples.length;
  document.getElementById('sAFL').innerText = average + ' ms';
  delete io_map[output.timestamp];

  output.close();

  let fps = outputs * 1000.0 / elapsed;
  document.getElementById('sDecoded').innerText = outputs;
  document.getElementById('sFPS').innerText = fps + ' fps';
  document.getElementById('sElapsed').innerText = elapsed + ' ms';

  if (stop || index >= MAX_INDEX) {
    if (!stop)
      decoder.flush();

    if (outputs >= MAX_INDEX && decoder.state != 'closed') {
      // FIXME: Workaround to ensure flush completes.
      setTimeout(_ => { decoder.close(); }, 1000);
    }

    stop = true;
    document.getElementById('sStatus').innerText = 'Done';
    return;
  }

  var queue_size = Object.keys(io_map).length;
  if (queue_size > 4)
    return;

  let moar = Math.min(4 - queue_size, MAX_INDEX - index);
  for (var i = 0; i < moar; ++i) {
    let chunk = CHUNKS[index % CHUNKS.length];
    let data = CHUNK_DATA[index % CHUNKS.length]
    chunk.timestamp = index;
    ++index;
    io_map[chunk.timestamp] = performance.now();
    decoder.decode(chunk, data); // FIXME: Remove data when chunks serialize.
  }
}

function receiveError(error) {
  stop = true;
  console.log(error);
  let status = document.getElementById('sStatus');
  status.style = 'color: red';
  status.innerText = 'Error';
}

const OpEnum = Object.freeze({
  'create' : 1,
  'configure' : 2,
  'decode' : 3,
  'flush' : 4,
  'reset' : 5,
  'close' : 6,
  'output' : 7,
  'error' : 8,
});

class WorkerDecoder {
  constructor(init) {
    this.init = init;
    this.state = 'unconfigured';
    this.worker = new Worker('worker-shim.js');
    this.worker.onmessage = e => {
      let data = e.data;
      switch (data.cmd) {
      case OpEnum.flush:
        // FIXME
        return;
      case OpEnum.error:
        this.error(data.exception);
        return;
      case OpEnum.output:
        this.output(data.output);
        return;
      };
    };
    this.worker.postMessage({'cmd' : OpEnum.create, 'type' : 'VideoDecoder'});
  }

  configure(config) {
    this.worker.postMessage({'cmd' : OpEnum.configure, 'config' : config});
    this.state = 'configured'; // FIXME: Could be a lie.
  }

  decode(chunk, data) {
    // FIXME, chunks need to be serializable/transferable.
    // this.worker.postMessage({'cmd': OpEnum.decode, 'chunk': chunk});
    this.worker.postMessage({
      'cmd' : OpEnum.decode,
      'timestamp' : chunk.timestamp,
      'type' : chunk.type,
      'data' : data
    });
  }

  flush() { this.worker.postMessage({'cmd' : OpEnum.flush}); }

  close() {
    this.state = 'closed';
    this.worker.postMessage({'cmd' : OpEnum.close});
  }

  state() { return this.state; }

  // FIXME: reset(), getters?

  output(output) { this.init.output(output); }

  error(error) {
    this.state = 'closed';
    this.init.error(error);
  }
}

function wait() {
  let wait_start = performance.now();
  let duration_ms = (Math.sin(index) + 1) * 25; // Sine shaped 25ms of busy.
  while (performance.now() - wait_start < duration_ms) {
    /* busy-wait */
  }

  if (!stop)
    setTimeout(wait, 0);
}

function startTest() {
  document.getElementById('bStart').disabled = true;
  document.getElementById('sConfig').innerText = window.location.search;

  startTime = performance.now();

  if (QueryString.busy) {
    setTimeout(wait, 0);
  }

  if (QueryString.worker) {
    decoder = new WorkerDecoder({output : receiveOutput, error : receiveError});
  } else {
    decoder = new VideoDecoder({output : receiveOutput, error : receiveError});
  }

  decoder.configure(CONFIG);
  CHUNKS.forEach(chunk => {
    ++index;
    io_map[chunk.timestamp] = performance.now();
    decoder.decode(
        chunk,
        CHUNK_DATA[index - 1]); // FIXME: Remove data when chunks serialize.
  });
}
