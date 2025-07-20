import dns from 'node:dns';

export function initDNSSpoof(){
    const originalLookup = dns.lookup;

    // Override for the whole process
    dns.lookup = function patchedLookup(hostname, options, callback) {

    // ── Our one special case ──────────────────────────────────
    if (hostname === 'api2.relay-x.io') {
        // Map to loop‑back; family 4 avoids ::1
        return process.nextTick(() =>
        callback(null, [{address: '127.0.0.1', family: 4}])
        );
    }

    // Anything else → real DNS
    return originalLookup.call(dns, hostname, options, callback);
    };
}