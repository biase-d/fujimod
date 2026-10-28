import { initialize, usb, type Device, type Memory, type Session } from 'fujimod';
import { listReports, retrieveListed, retrieveReport, removeReport } from './transfer';
import type { DeviceFileEntry } from '../device-files';
import type { ReportLink } from './report-link';
/** The last USB exchanges as text lines, oldest first, for an error's details. */
function traceLines(trace: InstanceType<typeof usb.tracing.Trace>) {
  const batch = trace.drain();
  const lines = [
    ...batch.protocolEvents.map((event) => ({
      sequence: event.sequence,
      time: event.timestampMs,
      text: `command 0x${event.command.toString(16)} ${usb.tracing.Phase[event.phase]}${event.failureMessage ? `: ${event.failureMessage}` : ''}`,
    })),
    ...batch.events.map((event) => ({
      sequence: event.sequence,
      time: event.timestampMs,
      text: `${usb.tracing.Stage[event.stage]} ${usb.tracing.Phase[event.phase]} requested ${event.requested ?? '-'} transferred ${event.transferred ?? '-'}${event.failureMessage ? `: ${event.failureMessage}` : ''}`,
    })),
  ].sort((a, b) => (a.sequence < b.sequence ? -1 : 1));
  const end = lines.at(-1)?.time ?? 0;
  return lines.map((line) => `${(line.time - end).toFixed(0)} ms ${line.text}`);
}
/** The camera chosen for a report, with its ff80 interfaces. */
export interface CameraChoice {
  name: string;
  interfaces: { id: number; label: string }[];
}
export interface ReportConnection {
  initialize(): Promise<void>;
  choose(): Promise<CameraChoice | undefined>;
  read(id: number, link: ReportLink, progress: (bytes: number) => void): Promise<Blob>;
  /** Every report on the camera, after `read` opened the session. */
  list?(): Promise<DeviceFileEntry[]>;
  /** Read a listed report; it becomes the report `remove` may delete. */
  readListed?(
    entry: DeviceFileEntry,
    progress: (bytes: number) => void,
  ): Promise<{ blob: Blob; link: ReportLink }>;
  remove?(link: ReportLink): Promise<void>;
  handOff(): Promise<void>;
  onDisconnect?(callback: () => void): () => void;
  dispose(): void;
}
/** Owns one selected session; handing it to Dev Tools never chooses another device. */
export class ReportUsb implements ReportConnection {
  private device?: Device;
  private interfaces: Awaited<ReturnType<Device['interfaces']>> = [];
  private session?: Session;
  private memory?: Memory;
  private verified?: ReportLink;
  /** The QR code's report, which names the camera's file service. */
  private service?: ReportLink;
  private choice?: CameraChoice;
  async initialize() {
    await initialize();
  }
  async choose() {
    this.dispose();
    this.device = await usb.requestDevice(usb.DeviceFilter.Diagnostic);
    if (!this.device) return;
    this.interfaces = await this.device.interfaces();
    this.choice = {
      name: this.device.productName || 'Fujifilm camera',
      interfaces: this.interfaces.map((item, id) => ({
        id,
        label: `Interface ${item.interface} · Alternate ${item.alternate}`,
      })),
    };
    return this.choice;
  }
  async read(id: number, link: ReportLink, progress: (bytes: number) => void) {
    if (!this.device || !this.interfaces[id]) throw Error('Choose a camera interface.');
    const limits = new usb.FirmwareLimits(16384, 32, 16384, 4096),
      options = new usb.TransferOptions(5000, 65536),
      trace = new usb.tracing.Trace(40, 262144);
    options.setTrace(trace);
    try {
      this.session = await usb.Session.open(this.device, this.interfaces[id], limits, options);
    } finally {
      limits.free();
      options.free();
    }
    const session = this.session;
    try {
      this.memory = await session.memory(link.firmware);
      const report = await retrieveReport(this.memory, link, progress);
      this.verified = { ...link };
      this.service = { ...link };
      return report;
    } catch (error) {
      if (error instanceof Error) Object.assign(error, { usbTrace: traceLines(trace) });
      // No close command or mode change after an unknown/wrong camera reply.
      session.abandon();
      session.free();
      this.memory?.free();
      this.memory = undefined;
      this.session = undefined;
      throw error;
    }
  }
  async list() {
    if (!this.memory || !this.service) throw Error('Camera disconnected.');
    return listReports(this.memory, this.service);
  }
  async readListed(entry: DeviceFileEntry, progress: (bytes: number) => void) {
    if (!this.memory || !this.service) throw Error('Camera disconnected.');
    this.verified = undefined;
    const report = await retrieveListed(this.memory, this.service, entry, progress);
    this.verified = { ...report.link };
    return report;
  }
  async remove(link: ReportLink) {
    const memory = this.memory;
    if (
      !this.verified ||
      ['files', 'path', 'bytes', 'commit'].some(
        (key) => this.verified![key as keyof ReportLink] !== link[key as keyof ReportLink],
      )
    )
      throw Error('Read and verify this report before deleting it.');
    if (!memory) throw Error('Camera disconnected.');
    await removeReport(memory, link);
    this.verified = undefined;
  }
  /** Close this page's report session so Dev Tools can take the camera. */
  async handOff(): Promise<void> {
    const session = this.session,
      memory = this.memory;
    this.session = undefined;
    this.memory = undefined;
    try {
      await memory?.close();
      await session?.close();
    } finally {
      memory?.free();
      session?.free();
      this.dispose();
    }
  }
  onDisconnect(callback: () => void) {
    const events = (navigator as Navigator & { usb?: EventTarget }).usb;
    const listener = (event: Event) => {
      const removed = (
        event as Event & { device?: { vendorId: number; productId: number; serialNumber?: string } }
      ).device;
      if (
        removed &&
        this.device &&
        removed.vendorId === this.device.vendorId &&
        removed.productId === this.device.productId &&
        removed.serialNumber === this.device.serialNumber
      )
        callback();
    };
    events?.addEventListener('disconnect', listener);
    return () => events?.removeEventListener('disconnect', listener);
  }
  dispose() {
    this.verified = undefined;
    this.service = undefined;
    this.session?.abandon();
    this.session?.free();
    this.session = undefined;
    this.memory?.free();
    this.memory = undefined;
    for (const item of this.interfaces) item.free();
    this.interfaces = [];
    this.device?.free();
    this.device = undefined;
  }
}
