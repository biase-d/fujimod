import { For, Show } from 'solid-js';
import { Icon } from '@fujimod/emulator-ui/ui/icons';
import type { FirmwareLibrary } from './firmware-library';
import { FileDrop } from '../ui/file-drop';
import './firmware-picker.css';

export function FirmwarePicker(props: {
  library: FirmwareLibrary;
  inputId: string;
  disabled?: boolean;
  heading?: string;
  description?: string;
}) {
  const disabled = () => props.disabled || props.library.busy();
  return (
    <section class="base-firmware-picker" aria-label={props.heading ?? 'Base firmware'}>
      <Show when={props.heading}>
        <h3>{props.heading}</h3>
      </Show>
      <Show when={props.description}>
        <p class="firmware-description">{props.description}</p>
      </Show>
      <Show when={props.library.entries().length}>
        <div class="firmware-saved" role="radiogroup" aria-label="Firmware in this browser">
          <For each={props.library.entries()}>
            {(firmware) => (
              <div class="firmware-saved-row">
                <label>
                  <input
                    class="firmware-radio-input"
                    type="radio"
                    name={props.inputId + '-saved'}
                    aria-label={firmware.name}
                    checked={props.library.selected() === firmware.sha256}
                    disabled={disabled()}
                    onChange={() => {
                      props.library.select(firmware.sha256);
                    }}
                  />
                  <span class="firmware-radio" aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                  <span class="firmware-saved-text">
                    <strong>{firmware.name}</strong>
                    <span>Saved in your browser •</span>
                  </span>
                </label>
                <button
                  class="firmware-remove"
                  disabled={disabled()}
                  aria-label={'Remove ' + firmware.name}
                  onClick={() => void props.library.remove(firmware.sha256)}
                >
                  Remove
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <FileDrop
        inputId={props.inputId}
        title={props.library.busy() ? 'Checking firmware…' : 'Add official firmware'}
        prompt="Drop a Fujifilm .DAT file here, or"
        accept=".dat,.DAT,application/octet-stream"
        label="Choose official Fujifilm firmware"
        highlighted={!props.library.entries().length}
        disabled={disabled()}
        onFile={(file) => void props.library.add(file)}
      />
      <Show when={props.library.error()}>
        <p class="firmware-error" role="alert">
          {props.library.error()}
        </p>
      </Show>
    </section>
  );
}
