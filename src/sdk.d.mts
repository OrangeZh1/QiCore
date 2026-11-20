export interface MenuEntry { path: string; title: string; permission: string; icon?: string }
export interface AccountIdentity {
  id: string
  login: string
  displayName: string
  enabled: boolean
  roleId: string
  role: { permissions: string[] }
}
export interface ApplicationDefinition {
  key: string
  title: string
  permissions: string[]
  menus: MenuEntry[]
}
export declare function defineApplication<T extends ApplicationDefinition>(definition: T): T
