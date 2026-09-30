export default async () => {
  const hook = process.env.BUILD_HOOK_URL;

  if (!hook) {
    console.error("BUILD_HOOK_URL is not configured");
    return new Response("BUILD_HOOK_URL is not configured", { status: 500 });
  }

  try {
    const response = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "scheduled football matches refresh" })
    });

    const text = await response.text();
    console.log(`Build hook response: ${response.status} ${text.slice(0, 500)}`);

    if (!response.ok) {
      return new Response(`Build hook failed: ${response.status}`, { status: 502 });
    }

    return new Response("Football matches build triggered", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Failed to trigger build", { status: 500 });
  }
};

export const config = {
  schedule: "@hourly"
};
