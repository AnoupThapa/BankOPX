import { ALL_MIMES, detectMime, safeDisplayName, validateFile } from './file-validation';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const v = (b: Buffer, name: string, declared?: string, accept = ALL_MIMES, max = 1000) => validateFile(b, declared, name, accept, max);

describe('file validation (DOC-01)', () => {
  it('detects type by signature, not by name', () => {
    expect(detectMime(JPEG)).toBe('image/jpeg'); expect(detectMime(PNG)).toBe('image/png'); expect(detectMime(PDF)).toBe('application/pdf');
    expect(detectMime(Buffer.from('MZ\x90\x00'))).toBeNull(); expect(detectMime(Buffer.from('PK\x03\x04'))).toBeNull();
  });
  it('accepts consistent files', () => {
    expect(v(JPEG, 'id.jpg', 'image/jpeg')).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(v(JPEG, 'ID.JPEG', 'application/octet-stream')).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(v(PDF, 'proof.pdf', 'application/pdf').ok).toBe(true);
  });
  it.each([
    ['empty', Buffer.alloc(0), 'a.jpg', 'empty'],
    ['executable renamed .jpg', Buffer.from('MZ\x90\x00\x03'), 'a.jpg', 'unsupported_type'],
    ['zip', Buffer.from('PK\x03\x04aaaa'), 'a.zip', 'unsupported_type'],
    ['png content named .jpg', PNG, 'a.jpg', 'type_mismatch'],
    ['double extension', JPEG, 'a.jpg.exe', 'type_mismatch'],
    ['declared type disagrees', JPEG, 'a.jpg', 'type_mismatch'],
    ['oversize', Buffer.concat([JPEG, Buffer.alloc(2000)]), 'a.jpg', 'too_large'],
    ['script inside an image', Buffer.concat([JPEG, Buffer.from('<script>alert(1)</script>')]), 'a.jpg', 'suspicious_content'],
    ['php inside an image', Buffer.concat([JPEG, Buffer.from('<?php system($_GET[1]);')]), 'a.jpg', 'suspicious_content'],
    ['pdf with javascript', Buffer.concat([PDF, Buffer.from('/JavaScript (app.alert(1))')]), 'a.pdf', 'suspicious_content'],
    ['pdf with launch action', Buffer.concat([PDF, Buffer.from('/Launch /Win')]), 'a.pdf', 'suspicious_content'],
  ])('rejects %s', (_n, bytes, name, reason) => { expect(v(bytes, name, name === 'a.jpg' && _n === 'declared type disagrees' ? 'image/png' : undefined)).toEqual({ ok: false, reason }); });
  it('respects the per-requirement format list', () => { expect(v(PDF, 'a.pdf', undefined, ['image/jpeg'])).toEqual({ ok: false, reason: 'not_allowed_here' }); });
  it('display names are sanitised and never become paths', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('passwd');
    expect(safeDisplayName('C:\\temp\\a b.jpg')).toBe('a b.jpg');
    const cleaned = safeDisplayName('x\u0000\n<script>.jpg');
    expect(cleaned.includes('\u0000') || cleaned.includes('\n') || cleaned.includes('<') || cleaned.includes('>')).toBe(false);
    expect(safeDisplayName('')).toBe('file'); expect(safeDisplayName('a'.repeat(500)).length).toBeLessThanOrEqual(80);
  });
});
