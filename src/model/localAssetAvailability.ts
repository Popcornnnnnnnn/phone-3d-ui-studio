export function isLocalModelResponse(response: Pick<Response, 'ok' | 'headers'>) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  // SPA servers can return index.html with status 200 for a missing GLB.
  return response.ok && (type === 'model/gltf-binary' || type === 'application/octet-stream')
}
