// Storyboards are public prose, not a rigid model response schema. Preserve the
// complete source as a fallback when two clearly labelled options are absent.

export type DesignOptionItem = {
  label: 'A' | 'B';
  title?: string;
  body: string;
  selected: boolean;
};

export type DesignOptionsPresentationResult = {
  options: [DesignOptionItem, DesignOptionItem];
  selected?: 'A' | 'B';
  reason?: string;
  status?: string;
  streaming?: boolean;
  incomplete?: boolean;
  sourceId?: string;
  blueprint?: string;
};

export function designOptionsPresentation(text: string, streaming = false): DesignOptionsPresentationResult | null {
  if (!text || typeof text !== 'string') return null;
  const interrupted = /Option generation interrupted; this draft is incomplete\./i.test(text);
  const partial = streaming || interrupted;

  // Matches option headers like:
  // "Option A", "Option B", "Option 1", "Option 2", "Direction A"
  // "### Option A: Clean Grid", "**Option B - Editorial Flow**"
  // "1. **Option A**", "- Option A:", "SELECTED: Option A"
  // Leave the line ending unconsumed. Otherwise matchAll starts searching after
  // the newline and misses an immediately following option heading that needs
  // that same newline as its line-start anchor.
  const markerRegex = /(?:^|\n)[ \t]*(?:[-*•+]|\d+[.)])?[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:(SELECTED|CHOSEN)\s*[-—–:]\s*)?(?:option|direction|prompt|concept)\s+([AB12])\b([ \t]*[:—–-][ \t]*)?([^\n*]+?)?(?:\*\*)?(?:[ \t]*[:—–-])?[ \t]*(?=\r?\n|$)/gi;

  const rawMatches = [...text.matchAll(markerRegex)];
  if (rawMatches.length < (partial ? 1 : 2)) return null;

  // Map 1 -> A, 2 -> B
  const markers = rawMatches.map(match => {
    let rawLabel = match[2].toUpperCase();
    if (rawLabel === '1') rawLabel = 'A';
    else if (rawLabel === '2') rawLabel = 'B';
    const separator = match[3]?.trim() ?? '';
    let tail = match[4] ? match[4].replace(/^\*\*/, '').replace(/\*\*$/, '').trim() : '';
    tail = tail.replace(/^[-—–:][ \t]*/, '');
    tail = tail.replace(/^\((?:not for construction|selected|chosen|build this)[^)]*\)\s*/i, '').trim();
    let title = '';
    let inlineBody = '';
    const colonSplit = tail.match(/^([^:]{1,80})\s*:\s*(.+)$/);
    if (separator.startsWith(':')) {
      // The colon after the label introduces the option copy, as in
      // "Option A: a centered product composition".
      inlineBody = tail;
    } else if (colonSplit) {
      title = colonSplit[1].replace(/^[-—–:]\s*/, '').replace(/^(?:not for construction|selected|chosen|build this)\s*[,—–-]?\s*/i, '').trim();
      inlineBody = colonSplit[2].trim();
    } else if (/^[:—–-]\s*/.test(tail)) {
      inlineBody = tail.replace(/^[:—–-]\s*/, '').trim();
    } else if (tail.length > 100) {
      // Long prose after the label is usually a same-line option description,
      // not a usable card title.
      inlineBody = tail;
    } else {
      title = tail;
    }
    return {
      index: match.index!,
      endIndex: match.index! + match[0].length,
      label: rawLabel as 'A' | 'B',
      title: title || undefined,
      selectedTag: Boolean(match[1]) || /\((?:selected|chosen|build this)[^)]*\)/i.test(match[4] || ''),
      inlineBody,
    };
  });

  // Some public option briefs announce the chosen concept first (for example,
  // "SELECTED — Option B, Index Spine") and then give the full A/B writeups.
  // Use the last labelled heading for each option so that short announcement
  // lines do not replace the detailed card content below them.
  const placeholder = (label: 'A' | 'B') => ({ index: text.length, endIndex: text.length, label, title: undefined, selectedTag: false, inlineBody: '' });
  const markerA = [...markers].reverse().find(m => m.label === 'A') ?? (partial ? placeholder('A') : undefined);
  const markerB = [...markers].reverse().find(m => m.label === 'B') ?? (partial ? placeholder('B') : undefined);
  if (!markerA || !markerB) return null;

  // Delimiters that mark the end of an option block (when appearing strictly AFTER that option's start)
  const delimiterRegex = /(?:^|\n)[ \t]*(?:[-*•+]|\d+[.)])?[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:(SELECTED|CHOSEN)\s*[-—–:]\s*)?(?:option|direction|prompt|concept)\s+[AB12]\b|(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?\b(?:structural\s*(?:&|and)\s*(?:conceptual\s+)?difference|selection reason|reason for (?:selection|choosing)|selected (?:option|direction|blueprint|layout)|chosen direction|selected layout blueprint|layout blueprint)\s*[:—–-]|(?:^|\n)[ \t]*(Revision needed before building\.|Selected direction can proceed\.)/gi;

  function extractBody(currentMarker: NonNullable<typeof markerA>, otherMarker: NonNullable<typeof markerB>): string {
    const start = currentMarker.endIndex;
    let end = text.length;

    delimiterRegex.lastIndex = start;
    let delimMatch: RegExpExecArray | null;
    while ((delimMatch = delimiterRegex.exec(text)) !== null) {
      if (delimMatch.index >= start) {
        end = delimMatch.index;
        break;
      }
    }

    if (otherMarker.index > currentMarker.index && otherMarker.index < end) {
      end = otherMarker.index;
    }

    const followingBody = text.slice(start, end)
      .replace(/^\*\*/, '')
      .replace(/\*\*$/, '')
      .replace(/^\s*[:—–-]\s*/, '')
      .trim();
    return [currentMarker.inlineBody, followingBody].filter(Boolean).join('\n\n');
  }

  const aBody = extractBody(markerA, markerB);
  const bBody = extractBody(markerB, markerA);

  if ((!aBody || !bBody) && !partial) return null;

  // Older option records sometimes place a structural comparison between
  // Option B and the selection. Keep it out of Option B's card and surface it
  // with the selection reason instead.
  const structuralDifferenceRegex = /(?:^|\n)[ \t]*(?:[-*•+]|\d+[.)])?[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?\bstructural\s*(?:&|and)\s*(?:conceptual\s+)?difference\b(?:\*\*)?\s*[:—–-]?\s*(?:\*\*)?([^\n]+)/i;
  const structuralDifferenceMatch = structuralDifferenceRegex.exec(text);

  // Extract selection reason
  const reasonRegex = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?\b(?:selection reason|reason chosen|reason for (?:selection|choosing))\s*[:—–-]?\s*(?:\*\*)?\s*([^\n]+(?:\n(?!\n[ \t]*(?:#{1,6}|[-*•+]|\d+[.)]|\*\*|[A-Z][a-z]+:))[^\n]+)*)/i;
  const reasonMatch = reasonRegex.exec(text);
  const selectionReason = reasonMatch ? reasonMatch[1].replace(/^\*\*/, '').replace(/\*\*$/, '').split(/\r?\n[ \t]*(?:Revision needed before building\.|Selected direction can proceed\.|Comparing the selected direction…|Option generation interrupted;)/i)[0].trim() : '';
  const structuralDifference = structuralDifferenceMatch?.[1]?.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
  const reason = [structuralDifference ? `Structural difference: ${structuralDifference}` : '', selectionReason].filter(Boolean).join(' ');

  // Extract status if present
  const statusMatch = /(?:^|\n)[ \t]*(Revision needed before building\..*|Selected direction can proceed\..*|Comparing the selected direction…|Option generation interrupted; this draft is incomplete\.)/i.exec(text);
  const status = statusMatch ? statusMatch[1].trim() : '';

  // Determine which option is selected
  let selectedOption: 'A' | 'B' | undefined;

  const announcedSelection = /(?:^|\n)[ \t]*(?:selected|chosen)\b[^\r\n]*?\b(?:option|direction|concept)\s*[:#]?\s*([AB12])\b/im.exec(text)?.[1]?.toUpperCase();
  if (announcedSelection) selectedOption = announcedSelection === '1' ? 'A' : announcedSelection === '2' ? 'B' : announcedSelection as 'A' | 'B';

  if (!selectedOption) {
    // A leading announcement is authoritative, even when its short header is
    // followed by a more detailed block for the same option.
    if (markers.some(marker => marker.label === 'A' && marker.selectedTag) || /^\s*(?:\([^)]*(?:selected|build this)[^)]*\)|[—–:-]\s*selected\b)/i.test(aBody)) {
      selectedOption = 'A';
    } else if (markers.some(marker => marker.label === 'B' && marker.selectedTag) || /^\s*(?:\([^)]*(?:selected|build this)[^)]*\)|[—–:-]\s*selected\b)/i.test(bBody)) {
      selectedOption = 'B';
    }
  }

  if (!selectedOption) {
    const globalSelectMatch = /\b(?:selected|chosen)\s*(?:option|direction|concept)?\s*[:—–-]?\s*([AB12])\b/i.exec(text);
    if (globalSelectMatch) {
      const char = globalSelectMatch[1].toUpperCase();
      selectedOption = char === '1' ? 'A' : char === '2' ? 'B' : (char as 'A' | 'B');
    }
  }

  if (!selectedOption && reason) {
    const reasonChoiceMatch = /\b(?:chose|chosen|selected|prefer(?:red)?)\s*(?:option|direction)?\s*([AB12])\b/i.exec(reason);
    if (reasonChoiceMatch) {
      const char = reasonChoiceMatch[1].toUpperCase();
      selectedOption = char === '1' ? 'A' : char === '2' ? 'B' : (char as 'A' | 'B');
    }
  }

  const optionA: DesignOptionItem = {
    label: 'A',
    title: markerA.title,
    body: aBody.replace(/\n\n(?:Comparing the selected direction…|Option generation interrupted; this draft is incomplete\.)$/, ''),
    selected: selectedOption === 'A',
  };

  const optionB: DesignOptionItem = {
    label: 'B',
    title: markerB.title,
    body: bBody.replace(/\n\n(?:Comparing the selected direction…|Option generation interrupted; this draft is incomplete\.)$/, ''),
    selected: selectedOption === 'B',
  };

  return {
    options: [optionA, optionB],
    selected: selectedOption,
    reason,
    status,
    streaming,
    incomplete: interrupted,
    blueprint: /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?Selected layout blueprint(?:\*\*)?[ \t]*[:—–-]?[ \t]*(?:\r?\n|$)([\s\S]*)/i.exec(text)?.[1]?.replace(/\n\n(?:Revision needed before building\.[\s\S]*|Selected direction can proceed\.[\s\S]*|Comparing the selected direction…|Option generation interrupted; this draft is incomplete\.)$/, '').trim(),
  };
}

