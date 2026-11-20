// One deployment may host a single business application. Retired descriptors
// in the identity history are deliberately not part of the active composition.
export function assertStandaloneComposition(descriptors) {
  const keys = new Set()
  const packages = new Set()
  const namespaces = new Set()
  let primary = null
  for (const descriptor of descriptors) {
    const { key, packageKey, format = 'qicore-application-v1' } = descriptor
    if (key === 'system' || !/^[a-z][a-z0-9-]{1,63}$/.test(key)) throw Error('APPLICATION_KEY_RESERVED_OR_INVALID')
    if (keys.has(key) || packages.has(packageKey)) throw Error('DUPLICATE_COMPONENT_IDENTITY')
    keys.add(key)
    packages.add(packageKey)
    if (format === 'qicore-plugin-v1') {
      if (!/^(plugin|plg)_[a-z0-9_]+$/.test(packageKey) || !/^[a-z][a-zA-Z0-9]{1,31}$/.test(descriptor.namespace)) throw Error('PLUGIN_IDENTITY_INVALID')
      if (namespaces.has(descriptor.namespace)) throw Error('PLUGIN_NAMESPACE_CONFLICT')
      namespaces.add(descriptor.namespace)
    } else {
      if (format !== 'qicore-application-v1' || !/^app_[a-z0-9_]+$/.test(packageKey) || descriptor.namespace !== undefined || descriptor.applicationKey !== undefined) throw Error('APPLICATION_IDENTITY_INVALID')
      if (primary) throw Error('STANDALONE_MULTIPLE_APPLICATIONS')
      primary = descriptor
    }
  }
  for (const descriptor of descriptors) {
    if (descriptor.format !== 'qicore-plugin-v1') continue
    if (!primary || (descriptor.applicationKey !== '*' && descriptor.applicationKey !== primary.key)) throw Error('PLUGIN_OWNER_MISMATCH')
  }
  return primary
}

export function assertComponentFlag(flag, descriptor) {
  const expected = flag === '--plugin' ? 'qicore-plugin-v1' : 'qicore-application-v1'
  if (descriptor.format !== expected) throw Error('COMPONENT_ARGUMENT_TYPE_MISMATCH: ' + flag)
}
