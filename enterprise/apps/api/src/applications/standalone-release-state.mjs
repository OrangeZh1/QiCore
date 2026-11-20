/** @typedef {{productKey:string, version:string, frameworkVersion:string, slot:string}} VerifiedRelease */
/** @type {Readonly<VerifiedRelease>|null} */
let activeRelease = null

// Installed-runtime initializes this only after authenticating the outer release
// and matching every file in the code slot. A later disk edit cannot rebind it.
/** @param {VerifiedRelease} release */
export function bindStandaloneRelease(release) {
  if (activeRelease) throw Error('STANDALONE_RELEASE_ALREADY_BOUND')
  activeRelease = Object.freeze({ ...release })
}
export function standaloneRelease() { return activeRelease }
