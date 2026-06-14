import { test } from 'node:test';
import assert from 'node:assert';
import { ipIsPrivate } from '../net';

test('ipIsPrivate bloquea loopback/privadas/CGNAT/metadata e IPv6 internas', () => {
  const block = [
    '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', 'fd12:3456::1',
  ];
  for (const ip of block) assert.equal(ipIsPrivate(ip), true, `debería bloquear ${ip}`);
});

test('ipIsPrivate permite IPs públicas (incl. bordes)', () => {
  const allow = [
    '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.169.0.1',
    '100.63.0.1', '100.128.0.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946',
  ];
  for (const ip of allow) assert.equal(ipIsPrivate(ip), false, `no debería bloquear ${ip}`);
});
