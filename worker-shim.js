var codec = null;

const OpEnum = Object.freeze({
  'create': 1,
  'configure': 2,
  'decode': 3,
  'flush': 4,
  'reset': 5,
  'close': 6,
  'output': 7,
  'error': 8,
});

function postOutput(output, metamsg) {
  self.postMessage(
      {'cmd': OpEnum.output, 'output': output, 'metamsg': metamsg}, [output]);
}

function postError(error) {
  self.postMessage({'cmd': OpEnum.error, 'exception': error});
}

self.addEventListener('message', function(e) {
  let msg = e.data;
  try {
    switch (msg.cmd) {
      case OpEnum.create:
        let init = {output: postOutput, error: postError};
        if (msg.type == 'VideoDecoder')
          codec = new VideoDecoder(init);
        else if (msg.type == 'AudioDecoder')
          codec = new AudioDecoder(init);
        else if (msg.type == 'VideoEncoder')
          codec = new VideoEncoder(init);
        else if (msg.type == 'AudioEncoder')
          codec = new AudioEncoder(init);
        else
          throw new TypeError('Unknown codec: ' + msg);
        return;
      case OpEnum.configure:
        codec.configure(msg.config);
        return;
      case OpEnum.decode:
        // FIXME: Chunks should be serializable.
        // codec.decode(msg.chunk);
        codec.decode(new EncodedVideoChunk(
            {type: msg.type, timestamp: msg.timestamp, data: msg.data}));
        return;
      case OpEnum.flush:
        codec.flush()
            .then(_ => {
              self.postMessage({'cmd': msg.cmd, 'success': true});
            })
            .catch(e => {
              postError(e);
            });
        return;
      case OpEnum.reset:
        codec.reset();
        return;

      case OpEnum.close:
        codec.close();
        return;

      default:
        throw new TypeError('Unknown command: ' + msg);
    };
  } catch (e) {
    postError(e);
  }
}, false);
