export function useCoreApi() {
  const request = useRequestFetch()
  return {
    async api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET', body?: unknown, options?: { signal?: AbortSignal }) {
      try {
        return await request<T>('/api' + path, { method, body: body as Record<string, unknown> | Blob | undefined, signal: options?.signal })
      } catch (error) {
        throw new Error(coreError(error, '请求失败，请重试'), { cause: error })
      }
    },
  }
}
