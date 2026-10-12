package ai.wizards.os.mizel;
import org.junit.Test;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.*;
public class LivePcmFramesTest {
 @Test public void emitsQuarterSecondFramesBeforeDurableFiveSecondChunk() {
  List<byte[]> frames=new ArrayList<>();List<Long> times=new ArrayList<>();
  LivePcmFrames f=new LivePcmFrames((p,t)->{frames.add(p);times.add(t);});short[] s=new short[1600];Arrays.fill(s,(short)0x1234);
  for(int n=0;n<3;n++)f.append(s,s.length,n*1600);
  assertEquals(1,frames.size());assertEquals(8000,frames.get(0).length);assertEquals(0L,(long)times.get(0));assertEquals(0x34,frames.get(0)[0]&255);assertEquals(0x12,frames.get(0)[1]&255);
  f.flush();assertEquals(2,frames.size());assertEquals(1600,frames.get(1).length);assertEquals(250L,(long)times.get(1));
 }
 @Test public void frameBuffersDetachedAndResumeAnchored() {
  List<byte[]> data=new ArrayList<>();List<Long> times=new ArrayList<>();LivePcmFrames f=new LivePcmFrames((p,t)->{data.add(p);times.add(t);});
  short[] s=new short[4000];s[0]=7;f.append(s,4000,16000);byte[] first=data.get(0).clone();Arrays.fill(s,(short)9);f.append(s,4000,20000);assertArrayEquals(first,data.get(0));assertEquals(1000L,(long)times.get(0));assertEquals(1250L,(long)times.get(1));
 }
 @Test public void resetDropsOnlyTransientPartialAndSinkFailureDoesNotBreakCapture() {
  List<byte[]> data=new ArrayList<>();LivePcmFrames f=new LivePcmFrames((p,t)->data.add(p));f.append(new short[1000],1000,0);f.reset();f.flush();assertTrue(data.isEmpty());
  LivePcmFrames bad=new LivePcmFrames((p,t)->{throw new IllegalStateException("live delivery fault");});bad.append(new short[8000],8000,0);bad.flush();
 }
 @Test public void protocolScopesSubscriptionAndPacket() throws Exception {
  JSONObject command=new JSONObject().put("id","p").put("cmd","pcm").put("meetingId","mt_test123").put("enabled",true);
  MizelProtocol.Cmd c=MizelProtocol.parse(command.toString());assertNull(c.error);assertTrue(c.enabled);
  command.put("meetingId","bad/id");assertNotNull(MizelProtocol.parse(command.toString()).error);
  JSONObject packet=new JSONObject(MizelProtocol.pcmPush("mt_test123",new byte[]{1,2,3,4},250));assertEquals("pcm",packet.getString("type"));assertEquals(250,packet.getLong("startMs"));assertEquals("mt_test123",packet.getString("meetingId"));assertArrayEquals(new byte[]{1,2,3,4},java.util.Base64.getDecoder().decode(packet.getString("pcm")));
  assertTrue(MizelProtocol.state(true,false,"mt_test123",1,0,0,"recording",1).getBoolean("livePcm"));
 }
}
