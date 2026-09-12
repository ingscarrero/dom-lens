import { describe, expect, it } from 'vitest';
import { insecureTransportWarning } from '@/lib/storage/settings';

describe('insecureTransportWarning', () => {
  it('is silent for loopback endpoints (LM Studio / Ollama defaults)', () => {
    expect(insecureTransportWarning('http://localhost:1234/v1')).toBeNull();
    expect(insecureTransportWarning('http://127.0.0.1:11434/v1')).toBeNull();
    expect(insecureTransportWarning('http://[::1]:1234/v1')).toBeNull();
    expect(insecureTransportWarning('http://lm.localhost/v1')).toBeNull();
  });

  it('is silent for https endpoints anywhere', () => {
    expect(insecureTransportWarning('https://api.openai.com/v1')).toBeNull();
    expect(insecureTransportWarning('https://192.168.1.20:8443/v1')).toBeNull();
  });

  it('warns for plain-http endpoints on LAN or public hosts', () => {
    expect(insecureTransportWarning('http://192.168.1.20:1234/v1')).toMatch(
      /192\.168\.1\.20:1234 is reached over plain HTTP/,
    );
    expect(insecureTransportWarning('http://llm.example.com/v1')).toMatch(/unencrypted/);
  });

  it('is silent for unparsable URLs (the connection test reports those)', () => {
    expect(insecureTransportWarning('')).toBeNull();
    expect(insecureTransportWarning('localhost:1234')).toBeNull();
  });
});
