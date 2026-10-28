import { createSignal } from 'solid-js';
import { Icon } from '@fujimod/emulator-ui/ui/icons';
import './file-drop.css';

/** A dashed drop target with a "choose a file" link for one file. */
export function FileDrop(props: {
  inputId: string;
  title: string;
  /** Text before the "choose a file" link, such as "Drop a Fujifilm .DAT file here, or". */
  prompt: string;
  accept: string;
  /** Accessible name of the hidden file input. */
  label: string;
  /** Tints the target blue when it is the next thing to do. */
  highlighted?: boolean;
  disabled?: boolean;
  onFile(file: File | undefined): void;
}) {
  const [dragging, setDragging] = createSignal(false);
  return (
    <div
      class={{
        'file-drop': true,
        'file-drop-highlighted': !!props.highlighted,
        dragging: dragging(),
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (!props.disabled) props.onFile(event.dataTransfer?.files[0]);
      }}
    >
      <span class="file-drop-icon">
        <Icon name="plus" size={20} />
      </span>
      <strong>{props.title}</strong>
      <span>
        {props.prompt}{' '}
        <label class="file-drop-choose" for={props.inputId}>
          choose a file
        </label>
      </span>
      <input
        class="visually-hidden"
        id={props.inputId}
        type="file"
        accept={props.accept}
        aria-label={props.label}
        disabled={props.disabled}
        onChange={(event) => {
          props.onFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
