package ai.wizards.os.everywhere;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Archimedes Anywhere's dictation clean-up, copied verbatim (OverlayService.cleanTranscriptForInsertion and its
 * helpers, TranscriptQualityPolicy). Months of James's real use tuned these rules: keep them in step with
 * ~/apps/archimedes-assistant rather than rewriting them.
 */
final class DictationCleanup {
    private DictationCleanup() { }

    private static final Pattern SPOKEN_TIME_PATTERN = Pattern.compile(
            "\\b(0?[1-9]|1[0-2])(?::([0-5][0-9]))?\\s*([ap])\\s*\\.?\\s*m(?:\\.(?=\\W|$)|\\b)",
            Pattern.CASE_INSENSITIVE);

    static String cleanTranscriptForInsertion(String text) {
        String cleaned = text == null ? "" : text.trim()
                .replace("\n", " ")
                .replace("\r", " ")
                .replaceAll(" +", " ");

        cleaned = stripTranscriptHyphenMarkers(cleaned);
        cleaned = applyGeneralGlossary(cleaned);
        cleaned = normalizeSpokenTimes(cleaned);
        cleaned = applyPersonalSpeechCleanup(cleaned);
        cleaned = applyObservedDuplicatePhraseCleanup(cleaned);
        cleaned = collapseRepeatedSentenceLoops(cleaned);
        cleaned = applyContextualGlossary(cleaned);
        cleaned = stripHallucinatedTailSnippets(cleaned);
        cleaned = normalizeAdjacentTerminalPunctuation(cleaned);

        // Smart period handling:
        // - Short fragments (< 6 words): strip trailing period
        // - Longer utterances or multi-sentence: keep the period
        if (cleaned.endsWith(".")) {
            int wordCount = cleaned.split("\\s+").length;
            boolean hasInternalPunctuation = cleaned.substring(0, cleaned.length() - 1)
                    .matches(".*[.!?].*");
            if (wordCount < 6 && !hasInternalPunctuation) {
                cleaned = cleaned.substring(0, cleaned.length() - 1);
            }
        }
        if (!cleaned.endsWith(" ")) {
            cleaned = cleaned + " ";
        }
        return cleaned;
    }

    static String normalizeAdjacentTerminalPunctuation(String text) {
        String cleaned = text;
        cleaned = cleaned.replaceAll(",\\s*([.!?])", "$1");
        cleaned = cleaned.replaceAll(";\\s*([.!?])", "$1");
        cleaned = cleaned.replaceAll(":\\s*([.!?])", "$1");
        cleaned = cleaned.replaceAll("([.!?])\\s*[.!?]+", "$1");
        return cleaned;
    }

    static String normalizeSpokenTimes(String text) {
        Matcher matcher = SPOKEN_TIME_PATTERN.matcher(text);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String hour = matcher.group(1).replaceFirst("^0+", "");
            String minutes = matcher.group(2);
            String suffix = matcher.group(3).toLowerCase(java.util.Locale.US) + "m";
            String replacement = (minutes == null || "00".equals(minutes))
                    ? hour + suffix
                    : hour + ":" + minutes + suffix;
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    static String stripTranscriptHyphenMarkers(String text) {
        String dashRun = "[-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212]+";
        String cleaned = text.replaceFirst("^(?:" + dashRun + "\\s*)+", "");
        cleaned = cleaned.replaceAll("([.!?]\\s+)(?:" + dashRun + "\\s+)+(?=[A-Za-z])", "$1");
        cleaned = cleaned.replaceAll(
                "(?i)(^|\\s)(?:" + dashRun + "\\s+)+(?=(?:yeah|okay|ok|also|and|so|but|well|right|um|uh)\\b)",
                "$1");
        return cleaned;
    }

    static String applyGeneralGlossary(String text) {
        String cleaned = text;
        cleaned = cleaned.replaceAll("(?i)\\bpawperian\\b", "Popperian");
        cleaned = cleaned.replaceAll("(?i)\\bpoparian\\b", "Popperian");
        cleaned = cleaned.replaceAll("(?i)\\bpoparians\\b", "Popperians");
        cleaned = cleaned.replaceAll("(?i)\\bto bluntly\\b", "too bluntly");
        cleaned = cleaned.replaceAll("(?i)\\bgnomonon\\b", "noumenon");
        cleaned = cleaned.replaceAll("(?i)\\bmadhya\\s+maka\\b", "Madhyamaka");
        cleaned = cleaned.replaceAll("(?i)\\bletterboxx\\b", "Letterboxd");
        cleaned = cleaned.replaceAll("(?i)\\s*,\\s*lol\\b[.!?]?$", " lol");
        cleaned = cleaned.replaceAll("(?i)(?<=\\S)\\s+lol\\b[.!?]?$", " lol");
        cleaned = cleaned.replaceAll("(?i)\\blol\\b", "lol");
        cleaned = cleaned.replaceAll("(?i)\\b(?:Nover|Noverre|Novere|Novera|Novair|Novare)\\b", "Novaire");
        cleaned = cleaned.replaceAll("(?i)\\bNo\\s?Vaire\\b", "Novaire");
        cleaned = cleaned.replaceAll("(?i)\\b(co-host\\s+)no\\s+bear\\b", "$1Novaire");
        cleaned = cleaned.replaceAll("(?i)\\bNovaire\\s+Sito\\b", "Novaire");
        cleaned = cleaned.replaceAll("(?i)\\bJames\\s+(?:the|de)\\s+Fleur\\b", "James DeFleur");
        cleaned = cleaned.replaceAll("(?i)\\bGraphene\\s+OS\\b", "GrapheneOS");
        cleaned = cleaned.replaceAll("(?i)\\bSony\\b(?=(?:['\\u2019]s)\\b)", "Somi");
        cleaned = cleaned.replaceAll("(?i)\\b(?:jay\\s+guan|jaevon)\\s+kim\\b", "Jaegwon Kim");
        cleaned = cleaned.replaceAll("(?i)\\b(?:ikigo|icky\\s+guy)\\b", "ikigai");
        cleaned = cleaned.replaceAll("(?i)\\bWaiting\\s+for\\s+God\\b", "Waiting for Godot");
        cleaned = cleaned.replaceAll("(?i)\\bAdhedonia\\b", "anhedonia");
        cleaned = cleaned.replaceAll("(?i)\\bt-sits\\b", "tea-sits");
        cleaned = cleaned.replaceAll("(?i)\\bt-sit\\b", "tea-sit");
        cleaned = cleaned.replaceAll("(?i)\\blarger\\s+interconnected\\s+hole\\b(?![-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212])", "larger interconnected whole");
        cleaned = cleaned.replaceAll("(?i)\\bvps\\b", "VPS");
        cleaned = cleaned.replaceAll("(?i)\\bllms\\b", "LLMs");
        cleaned = cleaned.replaceAll("(?i)\\bllm\\b", "LLM");
        cleaned = cleaned.replaceAll("(?i)\\bai\\b", "AI");
        cleaned = cleaned.replaceAll("(?i)\\btail\\s+net\\b", "Tailnet");
        cleaned = cleaned.replaceAll("(?i)\\bTelnet\\b", "Tailnet");
        cleaned = cleaned.replaceAll("(?i)\\bsecond\\s+renaissance\\s+(channel|podcast)\\b", "Second Renaissance $1");
        return cleaned;
    }

    static String applyPersonalSpeechCleanup(String text) {
        String cleaned = text;
        cleaned = cleaned.replaceAll("(?i)^we['\\u2019]ll\\b", "will");
        cleaned = cleaned.replaceAll("(?i)(\\.\\s*)we['\\u2019]ll\\b", "$1Will");
        cleaned = cleaned.replaceAll("(?i)(,\\s*)we['\\u2019]ll\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)^we\\s+will\\b", "will");
        cleaned = cleaned.replaceAll("(?i)(\\.\\s*)we\\s+will\\b", "$1Will");
        cleaned = cleaned.replaceAll("(?i)(,\\s*)we\\s+will\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)^((?:so|but|and)\\s+)we['\\u2019]ll\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)^((?:so|but|and)\\s+)we\\s+will\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)([.!?]\\s*(?:so|but|and)\\s+)we['\\u2019]ll\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)([.!?]\\s*(?:so|but|and)\\s+)we\\s+will\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)(,\\s*(?:so|but|and)\\s+)we['\\u2019]ll\\b", "$1will");
        cleaned = cleaned.replaceAll("(?i)(,\\s*(?:so|but|and)\\s+)we\\s+will\\b", "$1will");
        return cleaned;
    }

    static String applyObservedDuplicatePhraseCleanup(String text) {
        String cleaned = text;
        cleaned = cleaned.replaceAll("(?i)\\bdescribing\\s+describing\\b", "describing");
        cleaned = cleaned.replaceAll("(?i)\\b([A-Za-z]+(?:['\\u2019]s))\\s+\\1\\b", "$1");
        cleaned = cleaned.replaceAll(
                "(?i)\\b((?:[A-Za-z0-9]+(?:['\\u2019][A-Za-z0-9]+)?\\s+){3,}[A-Za-z0-9]+(?:['\\u2019][A-Za-z0-9]+)?)\\s+and\\s+\\1\\b",
                "$1");
        return cleaned;
    }

    static String collapseRepeatedSentenceLoops(String text) {
        java.util.regex.Pattern sentencePattern = java.util.regex.Pattern.compile("[^.!?]+[.!?]+|[^.!?]+$");
        java.util.regex.Matcher matcher = sentencePattern.matcher(text);
        java.util.ArrayList<String> sentences = new java.util.ArrayList<>();
        while (matcher.find()) {
            String sentence = matcher.group().trim();
            if (!sentence.isEmpty()) sentences.add(sentence);
        }
        if (sentences.size() < 3) return text;

        java.util.ArrayList<String> collapsed = new java.util.ArrayList<>();
        int i = 0;
        boolean changed = false;
        while (i < sentences.size()) {
            String current = sentences.get(i);
            String normalized = normalizeRepeatedSentence(current);
            int j = i + 1;
            while (j < sentences.size() && normalized.equals(normalizeRepeatedSentence(sentences.get(j)))) {
                j++;
            }
            int runLength = j - i;
            collapsed.add(current);
            if (runLength >= 3 || isFinalLongRepeatedSentence(sentences, i, j)) changed = true;
            else {
                for (int k = i + 1; k < j; k++) collapsed.add(sentences.get(k));
            }
            i = j;
        }
        if (!changed) return text;
        return String.join(" ", collapsed).replaceAll(" +", " ").trim();
    }

    static boolean isFinalLongRepeatedSentence(java.util.ArrayList<String> sentences, int start, int end) {
        if (end - start < 2 || end != sentences.size()) return false;
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("[A-Za-z0-9]+(?:['\\u2019][A-Za-z0-9]+)?")
                .matcher(sentences.get(start));
        int words = 0;
        while (matcher.find()) words++;
        return words >= 8;
    }

    static String normalizeRepeatedSentence(String text) {
        return text.toLowerCase(java.util.Locale.US)
                .replaceAll("[^a-z0-9'\\u2019]+", " ")
                .replaceAll(" +", " ")
                .trim();
    }

    static String stripHallucinatedTailSnippets(String text) {
        String snippet = "(?:mm-hmm|mhm|mhmm|mm hmm|uh-huh|uh huh|thank you|thanks)";
        java.util.regex.Pattern tailPattern = java.util.regex.Pattern.compile(
                "(?is)^(.+?)(?:\\s*[,;:]?\\s*" + snippet + "[.!?]*)\\s*$");
        java.util.regex.Matcher matcher = tailPattern.matcher(text);
        if (!matcher.matches()) return text;

        String prefix = matcher.group(1).trim();
        if (prefix.split("\\s+").length < 3) return text;
        if (prefix.matches("(?is).*\\b(say|saying|said|tell|telling|told|send|sending|sent|write|writing|wrote|owe|owed)\\s*$")) {
            return text;
        }
        return prefix.replaceAll("[ ,;:]+$", "");
    }

    static String applyContextualGlossary(String text) {
        String lower = text.toLowerCase(java.util.Locale.US);
        boolean partsWholeContext = lower.contains("part")
                && (lower.contains("nested")
                || lower.contains("whole")
                || lower.contains("holon")
                || lower.contains("relationship between things in nature"));
        if (!partsWholeContext) return text;

        String cleaned = text;
        cleaned = cleaned.replaceAll("(?i)\\bnested layer holes\\b", "nested layered wholes");
        cleaned = cleaned.replaceAll("(?i)\\bnested layered holes\\b", "nested layered wholes");
        cleaned = cleaned.replaceAll("(?i)\\bwithin the hole\\b", "within the whole");
        cleaned = cleaned.replaceAll("(?i)\\bthe hole and parts\\b", "the whole and parts");
        cleaned = cleaned.replaceAll("(?i)\\bhole and parts\\b", "whole and parts");
        cleaned = cleaned.replaceAll("(?i)\\bparts and holes\\b", "parts and wholes");
        cleaned = cleaned.replaceAll("(?i)\\bto each to each other\\b", "to each other");
        return cleaned;
    }

    static boolean isLikelyRepetitionLoop(String text) {
        if (text == null) return false;
        String cleaned = text.trim().toLowerCase(java.util.Locale.US);
        if (cleaned.length() < 40) return false;

        String[] words = cleaned.split("\\s+");
        if (words.length < 8) return false;

        // Decoder loops repeat one contiguous phrase many times. Check a range
        // of phrase lengths instead of one arbitrary n-gram size. A global
        // unique-word ratio is not evidence of a loop: ordinary long monologues
        // naturally reuse connective words and cross that threshold as they grow.
        int maxPhraseWords = Math.min(24, words.length / 3);
        for (int phraseWords = 3; phraseWords <= maxPhraseWords; phraseWords++) {
            for (int start = 0; start + 3 * phraseWords <= words.length; start++) {
                int copies = 1;
                while (start + (copies + 1) * phraseWords <= words.length
                        && samePhrase(words, start, start + copies * phraseWords, phraseWords)) {
                    copies++;
                }
                if (copies >= 3 && copies * phraseWords >= 24) return true;
            }
        }
        return false;
    }

    private static boolean samePhrase(String[] words, int left, int right, int length) {
        for (int offset = 0; offset < length; offset++) {
            if (!words[left + offset].equals(words[right + offset])) return false;
        }
        return true;
    }
}
