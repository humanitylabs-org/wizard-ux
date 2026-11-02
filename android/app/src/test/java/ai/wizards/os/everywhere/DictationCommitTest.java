package ai.wizards.os.everywhere;

import org.junit.Test;
import static org.junit.Assert.*;

public class DictationCommitTest {
    private DictationCommit.Snapshot s(String text, int a, int b) {
        return new DictationCommit.Snapshot(text, a, b, 0);
    }
    @Test public void exactInsertionPreservesPrefixAndSuffix() {
        assertTrue(DictationCommit.verifies(s("prefix suffix",7,7), s("prefix hello suffix",13,13),"hello "));
    }
    @Test public void replacesSelectionNotWholeField() {
        assertTrue(DictationCommit.verifies(s("left old right",5,8), s("left new right",8,8),"new"));
    }
    @Test public void selectedIdenticalPhraseVerifiedByCollapsedCursor() {
        assertTrue(DictationCommit.verifies(s("hello",0,5),s("hello",5,5),"hello"));
        assertFalse(DictationCommit.verifies(s("hello",0,5),s("hello",0,5),"hello"));
    }
    @Test public void existingPhraseAndPunctuationAreNotInsertion() {
        assertFalse(DictationCommit.verifies(s("hello",5,5),s("hello!",6,6),"hello"));
    }
    @Test public void existingPhraseAndCaseChangeAreNotInsertion() {
        assertFalse(DictationCommit.verifies(s("hello",5,5),s("Hello",5,5),"hello"));
    }
    @Test public void substringIsNotInsertion() {
        assertFalse(DictationCommit.verifies(s("",0,0),s("shelloworld",11,11),"hello"));
    }
    @Test public void unexpectedSuffixIsNotInsertionEvenAtRightCursor() {
        assertFalse(DictationCommit.verifies(s("",0,0),s("hello!",5,5),"hello"));
    }
    @Test public void edgeSpacesAreEvidence() {
        assertFalse(DictationCommit.verifies(s("left",4,4),s("lefthello",9,9)," hello "));
        assertTrue(DictationCommit.verifies(s("left",4,4),s("left hello ",11,11)," hello "));
    }
    @Test public void transformedNbspDoesNotInventSuccess() {
        assertFalse(DictationCommit.verifies(s("",0,0),s("hello\u00a0world",11,11),"hello world"));
    }
    @Test public void missingSelectionOrOffsetIsNotEmptyField() {
        assertFalse(DictationCommit.verifies(s("",-1,-1),s("hello",5,5),"hello"));
        assertFalse(DictationCommit.verifiesWindow(new DictationCommit.Snapshot("",0,0,-1),s("hello",5,5),"hello"));
    }
    @Test public void emptyPayloadAndNoOpDoNotVerify() {
        assertFalse(DictationCommit.verifies(s("x",1,1),s("x",1,1)," "));
        assertFalse(DictationCommit.verifies(s("hello",5,5),s("hello",5,5),"hello"));
    }
    @Test public void absoluteOffsetsFollowMovingIcWindow() {
        DictationCommit.Snapshot before = new DictationCommit.Snapshot("abcdefghijklmnopqrst tail",20,20,80);
        DictationCommit.Snapshot after = new DictationCommit.Snapshot("efghijklmnopqrst hello tail",22,22,84);
        assertTrue(DictationCommit.verifiesWindow(before,after," hello"));
    }
    @Test public void insufficientOverlapOrWrongOffsetRefuses() {
        DictationCommit.Snapshot before = new DictationCommit.Snapshot("abcdefghijklmnopqrst tail",20,20,80);
        assertFalse(DictationCommit.verifiesWindow(before,new DictationCommit.Snapshot("hello tail",5,5,100),"hello"));
        assertFalse(DictationCommit.verifiesWindow(before,new DictationCommit.Snapshot("abcdefghijklmnopqrsthello tail",25,25,81),"hello"));
    }
    @Test public void displayedHintWithAbsentSelectionHasOnlyEmptyCaret() {
        DictationCommit.Snapshot before = DictationCommit.nodeSnapshot("Synthetic hint","Synthetic hint",true,-1,-1);
        assertTrue(before.valid()); assertEquals("",before.text);
        assertEquals(0,before.start); assertEquals(0,before.end); assertEquals(0,before.offset);
        assertTrue(DictationCommit.verifies(before,s("Hello world ",12,12),"Hello world "));
    }
    @Test public void hintNormalizationDoesNotVerifyCorruptionNoopOrWrongCaret() {
        DictationCommit.Snapshot before = DictationCommit.nodeSnapshot("Synthetic hint","Synthetic hint",true,-1,-1);
        assertFalse(DictationCommit.verifies(before,s("shelloworld",11,11),"Hello "));
        assertFalse(DictationCommit.verifies(before,DictationCommit.nodeSnapshot("Synthetic hint","Synthetic hint",true,-1,-1),"Hello "));
        assertFalse(DictationCommit.verifies(before,s("Hello ",0,0),"Hello "));
    }
    @Test public void nonHintUnknownSelectionIsNeverNormalized() {
        assertFalse(DictationCommit.nodeSnapshot("",null,false,-1,-1).valid());
        assertFalse(DictationCommit.nodeSnapshot(null,null,false,-1,-1).valid());
        assertFalse(DictationCommit.nodeSnapshot("actual text",null,false,-1,-1).valid());
    }
    @Test public void partialAndMalformedHintSelectionsStayInvalid() {
        for (int[] selection : new int[][]{{-1,0},{0,-1},{-2,-2},{1,1},{0,1},{-1,1}})
            assertFalse(DictationCommit.nodeSnapshot("Synthetic hint","Synthetic hint",true,selection[0],selection[1]).valid());
    }
    @Test public void hintWithKnownCaretRemainsEmptyNotHintContent() {
        assertTrue(DictationCommit.nodeSnapshot("Synthetic hint","Synthetic hint",true,0,0).same(s("",0,0)));
        assertTrue(DictationCommit.nodeSnapshot(null,null,true,-1,-1).same(s("",0,0)));
        assertTrue(DictationCommit.nodeSnapshot("",null,true,-1,-1).same(s("",0,0)));
        assertTrue(DictationCommit.nodeSnapshot("actual text",null,false,4,4).same(s("actual text",4,4)));
    }
    @Test public void contradictoryHintContentIsNotEmptyEvidence() {
        assertFalse(DictationCommit.nodeSnapshot("actual text","Synthetic hint",true,-1,-1).valid());
        assertFalse(DictationCommit.nodeSnapshot("actual text",null,true,-1,-1).valid());
        assertFalse(DictationCommit.nodeSnapshot("actual text","Synthetic hint",true,0,0).valid());
    }
    @Test public void unknownIcOffsetsAndSelectionsRemainInvalid() {
        assertFalse(new DictationCommit.Snapshot("",-1,-1,0).valid());
        assertFalse(new DictationCommit.Snapshot("",0,0,-1).valid());
        assertFalse(DictationCommit.verifiesWindow(new DictationCommit.Snapshot("",0,0,-1),s("Hello ",6,6),"Hello "));
    }
    @Test public void reversedSelectionUsesExactReplacement() {
        assertTrue(DictationCommit.verifies(s("left old right",8,5),s("left new right",8,8),"new"));
    }
}
