import { render } from '@solidjs/web';
import { flush } from 'solid-js';
import { expect, test } from 'vite-plus/test';
import type { PhysicalControls } from 'fujimod';
import x70 from '../../../../catalog/bodies/x70/controls.json';
import { CommandFace, RockerFace, PadFace } from './control-faces';
import { PowerComboKeys } from './power-combo';

test('X70 recovery draws the pressed rocker, record and DISP/BACK, without the power switch', () => {
  const host = document.createElement('div');
  const dispose = render(
    () => <PowerComboKeys controls={x70 as PhysicalControls} modes={['sd', 'firmware_update']} />,
    host,
  );
  flush();
  expect([...host.querySelectorAll('[data-part]')].map((e) => e.getAttribute('data-part'))).toEqual(
    ['rocker', 'key', 'key'],
  );
  expect(host.querySelector('.rocker-drawing[data-held="press"] .drawing-arrow.push')).toBeTruthy();
  expect(host.querySelector('.dial-drawing')).toBeNull();
  expect(host.querySelector('.control-short-name')?.textContent).toBe('COMMAND');
  expect(host.querySelector('.key.rec i')).toBeTruthy();
  expect(host.querySelectorAll('[data-part="key"] .key.glow')).toHaveLength(2);
  expect(host.textContent).toContain('DISP\nBACK');
  expect(host.querySelectorAll('button')).toHaveLength(0);
  dispose();
});

test('service sequence draws USB, the held selector direction, and full shutter stage', () => {
  const host = document.createElement('div');
  const dispose = render(
    () => <PowerComboKeys controls={x70 as PhysicalControls} modes={['service']} />,
    host,
  );
  flush();
  expect(host.querySelector('[aria-label="USB connected"]')).toBeTruthy();
  expect(host.querySelector('.dpad .u.glow')).toBeTruthy();
  expect(host.querySelector('[data-part="shutter"] [data-action="full"].on')).toBeTruthy();
  dispose();
});

for (const held of ['decrease', 'press', 'increase'] as const) {
  test(`command mini draws the manual's ${held} arrow`, () => {
    const host = document.createElement('div');
    const dispose = render(
      () => (
        <CommandFace
          part={{ kind: 'command', marking: { shortName: 'COMMAND' }, held }}
          size="mini"
        />
      ),
      host,
    );
    flush();
    expect(host.querySelector('.dial-drawing')?.getAttribute('data-held')).toBe(held);
    expect(host.querySelector('.drawing-arrow.push') !== null).toBe(held === 'press');
    expect(host.querySelector('.drawing-arrow.turn.left') !== null).toBe(held === 'decrease');
    expect(host.querySelector('.drawing-arrow.turn.right') !== null).toBe(held === 'increase');
    expect(host.querySelector('.knurl')).toBeNull();
    dispose();
  });
}
for (const held of ['up', 'down', 'left', 'right', 'press'] as const) {
  test(`pad mini highlights only its held ${held} part`, () => {
    const host = document.createElement('div');
    const dispose = render(
      () => <PadFace part={{ kind: 'pad', marking: {}, held }} size="mini" />,
      host,
    );
    flush();
    expect(host.querySelectorAll('.glow')).toHaveLength(1);
    expect(host.querySelector('.glow')?.getAttribute('data-action')).toBe(held);
    expect(host.querySelector('.active')).toBeNull();
    dispose();
  });
}

for (const held of ['decrease', 'press', 'increase'] as const) {
  for (const size of ['panel', 'mini'] as const) {
    test(`rocker ${size} highlights only ${held} and draws its manual arrow`, () => {
      const host = document.createElement('div');
      const dispose = render(
        () => (
          <RockerFace
            part={{ kind: 'rocker', marking: { shortName: 'COMMAND' }, held }}
            size={size}
          />
        ),
        host,
      );
      flush();
      if (size === 'panel') {
        expect(host.querySelectorAll('.active')).toHaveLength(1);
        expect(host.querySelector('.active')?.getAttribute('data-action')).toBe(held);
        expect(host.querySelectorAll('[data-action]')).toHaveLength(3);
        expect(host.querySelector('.knurl')).toBeTruthy();
        expect(host.querySelector('.rocker-drawing')).toBeNull();
      } else {
        expect(host.querySelector('.rocker-drawing')?.getAttribute('data-held')).toBe(held);
        expect(host.querySelector('.drawing-arrow.push') !== null).toBe(held === 'press');
        expect(host.querySelector('.drawing-arrow.turn.left') !== null).toBe(held === 'decrease');
        expect(host.querySelector('.drawing-arrow.turn.right') !== null).toBe(held === 'increase');
        expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
          `COMMAND ${held}`,
        );
      }
      dispose();
    });
  }
}
