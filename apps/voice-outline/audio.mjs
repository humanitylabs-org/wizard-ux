// Combine shared-core PCM WAV chunks without copying headers into audio.
export function joinWav(chunks){
 const pcm=[];let format=null,total=0;
 for(const input of chunks){const b=Buffer.from(input);if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('Saved audio is not PCM WAV');let fmt=null,data=null;
  for(let at=12;at+8<=b.length;){const size=b.readUInt32LE(at+4),end=at+8+size;if(end>b.length)throw Error('Truncated saved audio');const kind=b.toString('ascii',at,at+4);if(kind==='fmt ')fmt=b.subarray(at+8,end);if(kind==='data')data=b.subarray(at+8,end);at=end+(size%2);}
  if(!fmt||fmt.length<16||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(14)!==16||!data)throw Error('Unsupported saved audio');
  if(format&&!format.equals(fmt))throw Error('Audio formats differ');format=fmt;total+=data.length;if(total>32*1024*1024)throw Error('Recording exceeds playback limit');pcm.push(data);
 }
 if(!format)throw Error('Recording is empty');const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(total+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);format.copy(header,20,0,16);header.write('data',36);header.writeUInt32LE(total,40);return Buffer.concat([header,...pcm]);
}
