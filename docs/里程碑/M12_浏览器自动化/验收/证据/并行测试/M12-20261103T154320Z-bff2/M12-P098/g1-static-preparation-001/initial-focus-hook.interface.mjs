// Optional coordinator interface, not an implemented focus/activation solution.
// A coordinator-reviewed one-shot hook must be pinned by path+SHA in the Native lease.
// Driver independently requires exact own Native+DOM focus continuously for1s afterwards.
export async function requestOwnInitialFocus({identity}) {
 return {strategy:'wait-only-interface',pid:identity.pid,userData:identity.userData,activationAttempted:false,foregroundProven:false};
}
