import {
  deleteProjectLogos,
  downloadProjectLogo,
  requestToken,
  supabaseRest,
  uploadProjectLogo,
  verifyAuthUser,
} from "../../lib/server/supabase";
import { hasModuleAccess } from "../../lib/server/module-access";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

type ProjectLogoRow = {
  id: string;
  client_logo_storage_path: string;
  client_logo_mime_type: string;
};

function projectIdFrom(request: Request, body?: FormData) {
  const value = String(
    body?.get("projectId") ||
      new URL(request.url).searchParams.get("project") ||
      "",
  ).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : "";
}

async function projectLogo(token: string, projectId: string) {
  const rows = await supabaseRest<ProjectLogoRow[]>(
    `projects?select=id,client_logo_storage_path,client_logo_mime_type&id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`,
    token,
  );
  return rows[0] || null;
}

async function administrator(request: Request, action: "edit" | "delete") {
  const token = requestToken(request);
  const user = await verifyAuthUser(token);
  if (!user) return { error: "Authentication required.", status: 401 } as const;
  const profiles = await supabaseRest<Array<{ role: string }>>(
    `app_users?select=role&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
    token,
  );
  if (
    profiles[0]?.role !== "admin" ||
    !(await hasModuleAccess(token, user.id, "administration", action))
  )
    return {
      error: "Administrator permission for this project is required.",
      status: 403,
    } as const;
  return { token, user } as const;
}

async function validImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/png")
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      )
    );
  if (file.type === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (file.type === "image/webp")
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const projectId = projectIdFrom(request);
    if (!projectId)
      return Response.json(
        { error: "A valid project is required." },
        { status: 400 },
      );
    const project = await projectLogo(token, projectId);
    if (!project)
      return Response.json(
        { error: "Project is unavailable to this account." },
        { status: 404 },
      );
    if (!project.client_logo_storage_path)
      return Response.json(
        { error: "This project has no client logo." },
        { status: 404 },
      );
    const data = await downloadProjectLogo(
      project.client_logo_storage_path,
      token,
    );
    return new Response(data, {
      headers: {
        "Content-Type": project.client_logo_mime_type || "image/png",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the project logo.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let newPath = "";
  try {
    const auth = await administrator(request, "edit");
    if ("error" in auth)
      return Response.json({ error: auth.error }, { status: auth.status });
    const form = await request.formData();
    const projectId = projectIdFrom(request, form);
    const file = form.get("logo");
    if (!projectId)
      return Response.json(
        { error: "A valid project is required." },
        { status: 400 },
      );
    if (!(file instanceof File) || file.size === 0)
      return Response.json(
        { error: "Choose a client logo image." },
        { status: 400 },
      );
    const extension = MIME_EXTENSIONS.get(file.type);
    if (
      !extension ||
      file.size > MAX_LOGO_BYTES ||
      !(await validImageSignature(file))
    )
      return Response.json(
        {
          error: "Use a valid PNG, JPG or WEBP logo no larger than 2 MB.",
        },
        { status: 415 },
      );
    const current = await projectLogo(auth.token, projectId);
    if (!current)
      return Response.json(
        { error: "Project is unavailable to this administrator." },
        { status: 403 },
      );
    newPath = `${projectId}/${crypto.randomUUID()}.${extension}`;
    await uploadProjectLogo(newPath, auth.token, file);
    const updated = await supabaseRest<ProjectLogoRow[]>(
      `projects?id=eq.${encodeURIComponent(projectId)}`,
      auth.token,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_logo_storage_path: newPath,
          client_logo_mime_type: file.type,
        }),
      },
    );
    if (!updated[0]) throw new Error("Project logo metadata was not saved.");
    if (
      current.client_logo_storage_path &&
      current.client_logo_storage_path !== newPath
    )
      await deleteProjectLogos(
        [current.client_logo_storage_path],
        auth.token,
      ).catch(() => undefined);
    return Response.json(
      { saved: true, projectId, mimeType: file.type },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const token = requestToken(request);
    if (newPath && token)
      await deleteProjectLogos([newPath], token).catch(() => undefined);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the project logo.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await administrator(request, "delete");
    if ("error" in auth)
      return Response.json({ error: auth.error }, { status: auth.status });
    const projectId = projectIdFrom(request);
    if (!projectId)
      return Response.json(
        { error: "A valid project is required." },
        { status: 400 },
      );
    const current = await projectLogo(auth.token, projectId);
    if (!current)
      return Response.json(
        { error: "Project is unavailable to this administrator." },
        { status: 403 },
      );
    const updated = await supabaseRest<ProjectLogoRow[]>(
      `projects?id=eq.${encodeURIComponent(projectId)}`,
      auth.token,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          client_logo_storage_path: "",
          client_logo_mime_type: "",
        }),
      },
    );
    if (!updated[0]) throw new Error("Project logo metadata was not cleared.");
    if (current.client_logo_storage_path)
      await deleteProjectLogos(
        [current.client_logo_storage_path],
        auth.token,
      ).catch(() => undefined);
    return Response.json(
      { deleted: true, projectId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to remove the project logo.",
      },
      { status: 500 },
    );
  }
}
