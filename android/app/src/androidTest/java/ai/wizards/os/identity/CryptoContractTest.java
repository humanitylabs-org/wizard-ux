package ai.wizards.os.identity;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import fr.acinq.secp256k1.Secp256k1;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Arrays;
import static org.junit.Assert.*;

/** Official BIP-340 vector and the prototype's real JNI contract, not a mock signer. */
@RunWith(AndroidJUnit4.class)
public class CryptoContractTest {
    @Test public void bip340OfficialVectorZero() {
        byte[] secret = new byte[32]; secret[31]=3;
        try {
            byte[] message = new byte[32];
            String pub = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
            String expected = "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0";
            byte[] sig = Secp256k1.get().signSchnorr(message,secret,new byte[32]);
            assertEquals(expected,NostrEvent.hex(sig));
            assertTrue(Secp256k1.get().verifySchnorr(sig,message,NostrEvent.bytes(pub)));
            sig[0]^=1; assertFalse(Secp256k1.get().verifySchnorr(sig,message,NostrEvent.bytes(pub)));
        } finally { Arrays.fill(secret,(byte)0); }
    }
    @Test public void nip01SignatureAndRestore() throws Exception {
        byte[] secret = new byte[32]; secret[31]=3;
        try {
            byte[] pub = Arrays.copyOfRange(Secp256k1.get().pubkeyCreate(secret),1,33);
            JSONObject e = NostrEvent.normalize(new JSONObject().put("kind",30117).put("tags",new JSONArray("[[\"name\",\"Night\"]]")).put("content",""),NostrEvent.hex(pub),1800000000);
            byte[] sig = Secp256k1.get().signSchnorr(NostrEvent.digest(e),secret,new byte[32]);
            assertTrue(Secp256k1.get().verifySchnorr(sig,NostrEvent.digest(e),pub));
            byte[] restored = Nip19.secret(Nip19.encode("nsec",secret));
            try { assertArrayEquals(pub,Arrays.copyOfRange(Secp256k1.get().pubkeyCreate(restored),1,33)); } finally { Arrays.fill(restored,(byte)0); }
            e.put("content","tampered"); assertFalse(Secp256k1.get().verifySchnorr(sig,NostrEvent.digest(e),pub));
        } finally { Arrays.fill(secret,(byte)0); }
    }
}
