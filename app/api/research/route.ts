/**
 * The current research chat is handled by POST /api/chat.
 * Keep this response for older clients so they receive a clear migration hint.
 */
export async function POST() {
  return Response.json(
    { error: "This endpoint has moved. Send research questions to /api/chat." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}