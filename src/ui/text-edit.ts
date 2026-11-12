/** Field-owned history keeps typing, paste and inserted tags in one undo sequence. */
export function textHistory(field: HTMLTextAreaElement) {
  type State = {
    value: string;
    start: number;
    end: number;
  };
  const read = (): State => ({
    value: field.value,
    start: field.selectionStart,
    end: field.selectionEnd
  });
  let states = [read()],
    index = 0,
    inserting = false,
    lastInput = 0,
    lastType = '';
  const apply = (at: number) => {
    if (at < 0 || at >= states.length) return;
    index = at;
    const s = states[index];
    field.value = s.value;
    field.setSelectionRange(s.start, s.end);
    field.dispatchEvent(new Event('text-history-change', {
      bubbles: true
    }));
  };
  const record = (type: string) => {
    const next = read();
    if (next.value === states[index].value) return;
    const now = performance.now();
    if (!inserting && type === 'insertText' && lastType === type && now - lastInput < 600 && index > 0) states[index] = next;else {
      states = states.slice(0, index + 1);
      states.push(next);
      index++;
    }
    lastInput = now;
    lastType = inserting ? '' : type;
  };
  const input = (event: Event) => record((event as InputEvent).inputType ?? '');
  const undo = (forward = false) => {
    lastType = '';
    apply(index + (forward ? 1 : -1));
  };
  const key = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      undo(event.shiftKey || event.key.toLowerCase() === 'y');
    }
  };
  const before = (event: InputEvent) => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      undo(event.inputType === 'historyRedo');
    }
  };
  field.addEventListener('input', input);
  field.addEventListener('keydown', key);
  field.addEventListener('beforeinput', before);
  return {
    insert(text: string, at: number, caret: number) {
      states[index] = {
        ...states[index],
        start: field.selectionStart,
        end: field.selectionEnd
      };
      inserting = true;
      field.setRangeText(text, at, at, 'end');
      field.setSelectionRange(at + caret, at + caret);
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
      inserting = false;
    },
    dispose() {
      field.removeEventListener('input', input);
      field.removeEventListener('keydown', key);
      field.removeEventListener('beforeinput', before);
    }
  };
}
