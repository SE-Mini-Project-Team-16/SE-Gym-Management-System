export async function request(path, { token, signal, ...options } = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    signal,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("We could not reach the gym service. Please try again.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || "Something went wrong. Please try again."),
      { status: response.status },
    );
  return data;
}
