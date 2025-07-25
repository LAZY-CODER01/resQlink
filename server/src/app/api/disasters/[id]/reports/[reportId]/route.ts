import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabaseServer";
import { getAuthenticatedUser } from "@/lib/authMiddlware";
import { withCorsHeaders } from "@/lib/withCors";
import { liveKitEmitter } from "@/lib/livekitEmitter";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    if (user.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden – admin only" }), { status: 403 });
    }

    const { id: disaster_id, reportId } = await params;
    const { action } = await req.json();

    if (!["approve", "reject"].includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
    }

    const newStatus = action === "approve" ? "verified" : "rejected";

    const { data, error } = await supabase
      .from("reports")
      .update({ verification_status: newStatus })
      .eq("id", reportId)
      .eq("disaster_id", disaster_id)
      .select("*");

    if (error || !data.length) {
      console.error(error?.message);
      return new Response(JSON.stringify({ error: "Failed to update report" }), { status: 500 });
    }

    // Invalidate relevant caches
    await supabase.from("cache").delete().eq("key", `reports:verified:${disaster_id}`);

    // Send the full report object as required by the type
    await liveKitEmitter("disaster-" + disaster_id, {
      type: "report_updated",
      data: {
        disaster_id: data[0].disaster_id,
        report_id: data[0].id,
        content: data[0].content,
        user_id: data[0].user_id,
        image_url: data[0].image_url,
        verification_status: data[0].verification_status,
        created_at: data[0].created_at,
      },
    });

    return withCorsHeaders(
      new Response(JSON.stringify({ success: true, status: newStatus }), { status: 200 })
    );
  } catch (err) {
    console.error("PUT /reports/:id moderation error:", err);
    return withCorsHeaders(
      new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 })
    );
  }
}
