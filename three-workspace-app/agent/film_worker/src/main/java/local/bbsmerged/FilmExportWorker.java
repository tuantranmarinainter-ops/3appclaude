package local.bbsmerged;

import com.google.gson.*;
import local.bbsmcp.data.BbsCodec;
import local.bbsmcp.data.BbsCodec.Node;
import local.bbsmcp.editor.FilmEditor;
import java.io.IOException;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

import static local.bbsmcp.data.BbsCodec.*;

/** Offline BBS FS 2.4 Film package writer. It never resolves a game/world path. */
public final class FilmExportWorker {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static final long MAX_MANIFEST = 64L * 1024 * 1024;
    private static final long MAX_ASSET = 256L * 1024 * 1024;
    private static final long MAX_TOTAL_ASSETS = 512L * 1024 * 1024;

    private FilmExportWorker() {}

    public static void main(String[] args) {
        try {
            if (args.length != 2) throw new IllegalArgumentException("Expected manifest.json and an existing output directory");
            JsonObject result = export(Path.of(args[0]), Path.of(args[1]));
            System.out.println(JSON.toJson(result));
        } catch (Exception error) {
            System.err.println(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            System.exit(2);
        }
    }

    static JsonObject export(Path manifestPath, Path outputRoot) throws Exception {
        Path manifestFile = manifestPath.toRealPath(LinkOption.NOFOLLOW_LINKS);
        if (!Files.isRegularFile(manifestFile, LinkOption.NOFOLLOW_LINKS) || Files.size(manifestFile) > MAX_MANIFEST)
            throw new IllegalArgumentException("Manifest must be a regular file up to 64 MiB");
        Path out = outputRoot.toRealPath(LinkOption.NOFOLLOW_LINKS);
        if (!Files.isDirectory(out, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(out))
            throw new IllegalArgumentException("Output path must be an existing local directory");

        JsonObject manifest;
        try (var reader = Files.newBufferedReader(manifestFile)) { manifest = JsonParser.parseReader(reader).getAsJsonObject(); }
        require(manifest, "schemaVersion").getAsInt();
        if (manifest.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("Unsupported export manifest version");
        if (!"2.4".equals(text(manifest, "targetVersion"))) throw new IllegalArgumentException("Only BBS FS 2.4 is supported");
        String filmName = text(manifest, "filmName");
        if (!filmName.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}") || filmName.endsWith(".")) throw new IllegalArgumentException("Invalid filmName");
        String mode = text(manifest, "mode");
        if (!Set.of("playback", "editable").contains(mode)) throw new IllegalArgumentException("mode must be playback or editable");
        int duration = integer(manifest, "durationTicks", 1, 1_000_000);
        long revision = longInteger(manifest, "sourceRevision", 0, Long.MAX_VALUE);
        String projectId = text(manifest, "projectId");
        if (!projectId.matches("[A-Za-z0-9_-]{1,128}")) throw new IllegalArgumentException("Invalid projectId");
        JsonArray actors = array(manifest, "actors", 1, 64);
        JsonArray cameras = array(manifest, "cameras", 1, 3);
        JsonArray models = manifest.has("models") ? array(manifest, "models", 0, 64) : new JsonArray();
        // B15: AAA Particles effects (App 2 VFX cues) become extra replays after the actors.
        JsonArray aaaEffects = manifest.has("aaaEffects") ? array(manifest, "aaaEffects", 0, 192) : new JsonArray();

        Path finalDir = out.resolve(filmName);
        if (Files.exists(finalDir, LinkOption.NOFOLLOW_LINKS)) throw new IllegalArgumentException("Export destination already exists");
        Path stage = Files.createTempDirectory(out, ".bbs-film-stage-");
        boolean moved = false;
        try {
            Path filmsDir = Files.createDirectory(stage.resolve("films"));
            Path modelsDir = Files.createDirectories(stage.resolve("assets/models"));
            Path stateDir = Files.createDirectory(stage.resolve("state"));
            Map<String, JsonObject> modelById = new LinkedHashMap<>();
            long copiedBytes = 0;
            JsonArray exportedAssets = new JsonArray();
            for (JsonElement item : models) {
                JsonObject model = item.getAsJsonObject();
                String id = text(model, "id");
                if (!safeModelId(id) || modelById.putIfAbsent(id, model) != null) throw new IllegalArgumentException("Invalid or duplicate model id");
                JsonArray bones = array(model, "bones", 1, 512);
                Set<String> boneNames = new HashSet<>();
                for (JsonElement bone : bones) {
                    String name = bone.getAsString();
                    if (!name.matches("[A-Za-z0-9_.-]{1,128}") || !boneNames.add(name)) throw new IllegalArgumentException("Invalid or duplicate model bone");
                }
                JsonArray actions = model.has("actions") ? array(model, "actions", 0, 512) : new JsonArray();
                Set<String> actionNames = new HashSet<>();
                for (JsonElement action : actions) if (!actionNames.add(action.getAsString())) throw new IllegalArgumentException("Duplicate model action");
                JsonArray files = array(model, "files", 1, 64);
                if (!model.has("textureRequired") || !model.get("textureRequired").isJsonPrimitive() || !model.getAsJsonPrimitive("textureRequired").isBoolean()) throw new IllegalArgumentException("Model textureRequired must come from the verified asset profile");
                boolean textureRequired = model.get("textureRequired").getAsBoolean();
                boolean hasBobj = false;
                boolean hasTexture = false;
                Set<String> targetNames = new HashSet<>();
                JsonArray assetFiles = new JsonArray();
                Path modelRoot = modelsDir.resolve(id).normalize();
                if (!modelRoot.startsWith(modelsDir)) throw new IllegalArgumentException("Model path escapes package");
                for (JsonElement fileItem : files) {
                    JsonObject file = fileItem.getAsJsonObject();
                    String targetName = text(file, "targetPath");
                    if (!safeAssetPath(targetName) || !targetNames.add(targetName.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("Invalid or duplicate asset target path");
                    if (targetName.equals("model.bobj")) hasBobj = true;
                    if (targetName.toLowerCase(Locale.ROOT).endsWith(".png")) hasTexture = true;
                    Path source = Path.of(text(file, "sourcePath")).toRealPath(LinkOption.NOFOLLOW_LINKS);
                    if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(source)) throw new IllegalArgumentException("Asset source must be a regular non-symlink file");
                    long size = Files.size(source);
                    if (size <= 0 || size > MAX_ASSET || (copiedBytes += size) > MAX_TOTAL_ASSETS) throw new IllegalArgumentException("Model assets exceed the package size limit");
                    String expected = text(file, "sha256").toLowerCase(Locale.ROOT);
                    if (!expected.matches("[0-9a-f]{64}") || !expected.equals(sha256(source))) throw new IllegalArgumentException("Asset SHA-256 mismatch");
                    Path target = modelRoot.resolve(targetName).normalize();
                    if (!target.startsWith(modelRoot)) throw new IllegalArgumentException("Asset target escapes model directory");
                    Files.createDirectories(target.getParent());
                    Files.copy(source, target, StandardCopyOption.COPY_ATTRIBUTES);
                    if (!expected.equals(sha256(target))) throw new IOException("Copied asset SHA-256 mismatch");
                    JsonObject saved = new JsonObject(); saved.addProperty("path", "assets/models/" + id + "/" + targetName); saved.addProperty("sizeBytes", size); saved.addProperty("sha256", expected); assetFiles.add(saved);
                }
                if (!hasBobj) throw new IllegalArgumentException("Each BBS model must include model.bobj");
                if (textureRequired && !hasTexture) throw new IllegalArgumentException("Model profile requires texture files, but none were packaged");
                JsonObject savedModel = new JsonObject(); savedModel.addProperty("id", id); savedModel.add("files", assetFiles); exportedAssets.add(savedModel);
            }

            FilmEditor editor = new FilmEditor(filmsDir, modelsDir, stateDir, "offline-export");
            JsonObject create = new JsonObject(); create.addProperty("duration_ticks", duration); create.addProperty("description", "Exported from unified project " + projectId);
            String draft = require(editor.invoke("create_film", create).getAsJsonObject(), "draft").getAsString();
            DraftEditor draftEditor = new DraftEditor(editor);
            Map<String, String> replayByCharacter = new LinkedHashMap<>();
            JsonArray actorMap = new JsonArray();
            Set<String> characterIds = new HashSet<>();
            int poseTrackCount = 0;
            for (JsonElement actorItem : actors) {
                JsonObject actor = actorItem.getAsJsonObject();
                String characterId = text(actor, "characterId");
                if (characterId.isBlank() || characterId.length() > 128 || !characterIds.add(characterId)) throw new IllegalArgumentException("Invalid or duplicate characterId");
                String actorName = text(actor, "name");
                if (actorName.isBlank() || actorName.length() > 64) throw new IllegalArgumentException("Actor name must contain 1-64 characters");
                JsonArray samples = array(actor, "transformSamples", 1, 256);
                validateTicks(samples, duration, "transformSamples");
                JsonObject first = samples.get(0).getAsJsonObject();
                JsonObject add = new JsonObject(); add.addProperty("filmId", draft); add.addProperty("label", actorName);
                for (String component : List.of("x", "y", "z", "pitch", "yaw")) add.addProperty(component, finite(first, component));
                if (actor.has("actorType")) {
                    String actorType = actor.get("actorType").getAsString();
                    if (!Set.of("male", "female").contains(actorType)) throw new IllegalArgumentException("actorType must be male or female");
                    add.addProperty("actorType", actorType);
                }
                add.addProperty("actorEntity", actor.has("actorEntity") && actor.get("actorEntity").getAsBoolean());
                JsonObject added = draftEditor.invoke("add_actor", add).getAsJsonObject();
                String replayId = require(added, "replayId").getAsString();
                String modelId = actor.has("modelId") ? actor.get("modelId").getAsString() : "";
                if (!modelId.isEmpty()) {
                    JsonObject model = modelById.get(modelId);
                    if (model == null) throw new IllegalArgumentException("Actor references an unknown modelId");
                    JsonObject bind = new JsonObject(); bind.addProperty("filmId", draft); bind.addProperty("replayId", replayId); bind.addProperty("modelId", modelId);
                    draftEditor.invoke("set_model_form", bind);
                }
                JsonArray transformFrames = new JsonArray();
                for (JsonElement sampleElement : samples) {
                    JsonObject sample = sampleElement.getAsJsonObject(), frame = new JsonObject();
                    frame.addProperty("filmId", draft); frame.addProperty("replayId", replayId); frame.addProperty("tick", integer(sample, "tick", 0, duration));
                    for (String component : List.of("x", "y", "z", "pitch", "yaw")) frame.addProperty(component, finite(sample, component));
                    transformFrames.add(frame);
                }
                JsonObject transforms = new JsonObject(); transforms.addProperty("filmId", draft); transforms.add("keyframes", transformFrames);
                draftEditor.invoke("set_transform_keyframes", transforms);
                JsonArray poses = actor.has("poseTracks") ? array(actor, "poseTracks", 0, 512) : new JsonArray();
                JsonArray animations = actor.has("animationKeyframes") ? array(actor, "animationKeyframes", 0, 256) : new JsonArray();
                if (animations.size() > 0) validateTicks(animations, duration, "animation keyframes");
                if (poses.size() > 0 && (mode.equals("playback") || animations.size() > 0)) throw new IllegalArgumentException("Editable pose tracks cannot overlap playback actions");
                if (poses.size() > 0 && modelId.isEmpty()) throw new IllegalArgumentException("Editable pose tracks require a BOBJ model");
                JsonObject model = modelId.isEmpty() ? null : modelById.get(modelId);
                Set<String> modelBones = model == null ? Set.of() : strings(array(model, "bones", 1, 512));
                for (JsonElement poseItem : poses) {
                    JsonObject pose = poseItem.getAsJsonObject(); String bone = text(pose, "boneName");
                    if (!modelBones.contains(bone)) throw new IllegalArgumentException("Pose track bone is not in the selected Skeleton Profile: " + bone);
                    JsonArray keys = array(pose, "keyframes", 1, 256); validateTicks(keys, duration, "pose keyframes");
                    JsonObject setPose = new JsonObject(); setPose.addProperty("filmId", draft); setPose.addProperty("replayId", replayId); setPose.addProperty("boneName", bone); setPose.add("keyframes", keys);
                    draftEditor.invoke("set_pose_transform_keyframes", setPose);
                    poseTrackCount++;
                }
                Set<String> modelActions = model == null || !model.has("actions") ? Set.of() : strings(array(model, "actions", 0, 512));
                for (JsonElement animationItem : animations) {
                    JsonObject animation = animationItem.getAsJsonObject(); String actionName = text(animation, "animationName");
                    if (model == null || !modelActions.contains(actionName)) throw new IllegalArgumentException("Animation action is not listed by the selected BOBJ profile: " + actionName);
                    JsonObject command = animation.deepCopy(); command.addProperty("filmId", draft); command.addProperty("replayId", replayId);
                    command.addProperty("timelineTick", integer(animation, "tick", 0, duration)); command.remove("tick"); command.addProperty("actionTick", integer(animation, "actionTick", 0, 1_000_000));
                    draftEditor.invoke("add_animation_keyframe", command);
                }
                replayByCharacter.put(characterId, replayId);
                JsonObject mapping = new JsonObject(); mapping.addProperty("characterId", characterId); mapping.addProperty("replayId", replayId); if (!modelId.isEmpty()) mapping.addProperty("modelId", modelId); actorMap.add(mapping);
            }

            JsonArray cameraMap = new JsonArray();
            Set<String> cameraIds = new HashSet<>();
            for (JsonElement cameraItem : cameras) {
                JsonObject camera = cameraItem.getAsJsonObject(); String id = text(camera, "id");
                if (id.isBlank() || id.length() > 128 || !cameraIds.add(id)) throw new IllegalArgumentException("Invalid or duplicate camera id");
                int start = integer(camera, "startTick", 0, duration); int clipDuration = integer(camera, "durationTicks", 1, duration);
                if (start + clipDuration > duration) throw new IllegalArgumentException("Camera clip exceeds Film duration");
                JsonArray keys = array(camera, "keyframes", 1, 256); validateRelativeTicks(keys, clipDuration);
                JsonObject clipArgs = new JsonObject(); clipArgs.addProperty("filmId", draft); clipArgs.addProperty("title", id); clipArgs.addProperty("startTick", start); clipArgs.addProperty("duration", clipDuration);
                JsonObject clip = draftEditor.invoke("add_camera_clip", clipArgs).getAsJsonObject(); String clipId = require(clip, "clipId").getAsString();
                for (JsonElement keyItem : keys) {
                    JsonObject key = keyItem.getAsJsonObject(); JsonObject set = new JsonObject(); set.addProperty("filmId", draft); set.addProperty("clipId", clipId);
                    set.addProperty("relativeTick", integer(key, "tick", 0, clipDuration));
                    for (String component : List.of("x", "y", "z", "pitch", "yaw", "roll")) set.addProperty(component, finite(key, component));
                    double fov = finite(key, "verticalFovDegrees"); if (fov <= 0 || fov >= 180) throw new IllegalArgumentException("Camera vertical FOV must be in (0,180)");
                    set.addProperty("fov", fov);
                    draftEditor.invoke("add_camera_keyframe", set);
                }
                JsonObject mapping = new JsonObject(); mapping.addProperty("id", id); mapping.addProperty("clipId", clipId); mapping.addProperty("startTick", start); mapping.addProperty("durationTicks", clipDuration); cameraMap.add(mapping);
            }

            for (JsonElement effectItem : aaaEffects) {
                JsonObject effect = effectItem.getAsJsonObject(); JsonObject add = new JsonObject(); add.addProperty("filmId", draft);
                add.addProperty("label", "VFX " + text(effect, "label")); add.addProperty("effect", text(effect, "effect"));
                for (String component : List.of("x", "y", "z", "yaw", "scale")) add.addProperty(component, finite(effect, component));
                add.addProperty("startTick", integer(effect, "startTick", 0, duration)); add.addProperty("endTick", integer(effect, "endTick", 1, duration)); add.addProperty("durationTicks", duration);
                if (effect.has("manual")) add.addProperty("manual", effect.get("manual").getAsBoolean());
                draftEditor.invoke("add_aaa_particle_actor", add);
            }
            JsonObject publish = new JsonObject(); publish.addProperty("draft", draft); publish.addProperty("film", filmName); publish.addProperty("editor_closed", true);
            JsonObject published = editor.invoke("publish_film", publish).getAsJsonObject();
            Path nativeFilm = Path.of(require(published, "path").getAsString()).toRealPath(LinkOption.NOFOLLOW_LINKS);
            if (!nativeFilm.startsWith(filmsDir.toRealPath()) || !Files.isRegularFile(nativeFilm, LinkOption.NOFOLLOW_LINKS)) throw new IOException("BBS writer returned an unsafe Film path");
            byte[] bytes = Files.readAllBytes(nativeFilm);
            if (!BbsCodec.isCompressed(bytes)) throw new IOException("Published file is not compressed native BBS data");
            Node decoded = BbsCodec.read(bytes);
            String semantic = BbsCodec.toJson(decoded).toString();
            String reread = BbsCodec.toJson(BbsCodec.read(BbsCodec.write(decoded, true))).toString();
            if (!semantic.equals(reread)) throw new IOException("BBS typed codec semantic read-back mismatch");
            JsonObject decodedJson = BbsCodec.toJson(decoded).getAsJsonObject();
            if (array(decodedJson, "replays", 0, 256).size() != actors.size() + aaaEffects.size()) throw new IOException("Film actor count changed during native read-back");
            long emittedCameras = array(decodedJson, "camera", 0, 4096).asList().stream().filter(c -> c.isJsonObject() && c.getAsJsonObject().has("mcp_id") && c.getAsJsonObject().has("title") && cameraIds.contains(c.getAsJsonObject().get("title").getAsString())).count();
            if (emittedCameras != cameras.size()) throw new IOException("Film camera count changed during native read-back");
            int actualPoseTracks = 0;
            JsonArray readActors = decodedJson.getAsJsonArray("replays");
            for (int i=0;i<actors.size();i++) {
                JsonObject sourceActor=actors.get(i).getAsJsonObject(); JsonObject tracks=new JsonObject();
                if(sourceActor.has("poseTracks")) for(JsonElement poseElement:sourceActor.getAsJsonArray("poseTracks")) {
                    JsonObject pose=poseElement.getAsJsonObject(); String bone=text(pose,"boneName");
                    if(tracks.has(bone)) throw new IOException("Duplicate pose-track bone after validation: "+bone);
                    tracks.add(bone,pose);
                }
                if(tracks.size()==0) continue;
                JsonObject properties=readActors.get(i).getAsJsonObject().getAsJsonObject("properties");
                for(String bone:tracks.keySet()) {
                    JsonObject channel=properties==null?null:properties.getAsJsonObject("pose.bones."+bone);
                    if(channel==null||!channel.has("type")||!"pose_transform".equals(channel.get("type").getAsString())||!channel.has("keyframes")||channel.getAsJsonArray("keyframes").size()!=tracks.getAsJsonObject(bone).getAsJsonArray("keyframes").size()) throw new IOException("Editable pose track failed native read-back: "+bone);
                    actualPoseTracks++;
                }
            }
            if(actualPoseTracks!=poseTrackCount) throw new IOException("Editable pose-track count changed during native read-back");
            JsonObject filmFile = new JsonObject(); filmFile.addProperty("path", "films/" + nativeFilm.getFileName()); filmFile.addProperty("sizeBytes", bytes.length); filmFile.addProperty("sha256", sha256(bytes));
            JsonObject exportManifest = new JsonObject(); exportManifest.addProperty("schemaVersion", 1); exportManifest.addProperty("targetVersion", "2.4"); exportManifest.addProperty("mode", mode); exportManifest.addProperty("filmName", filmName); exportManifest.addProperty("projectId", projectId); exportManifest.addProperty("sourceRevision", revision); exportManifest.add("film", filmFile); exportManifest.add("assets", exportedAssets); exportManifest.add("actors", actorMap); exportManifest.add("cameras", cameraMap);
            if (manifest.has("sourceHashes")) exportManifest.add("sourceHashes", manifest.get("sourceHashes").deepCopy());
            Files.writeString(stage.resolve("export-manifest.json"), JSON.toJson(exportManifest), StandardOpenOption.CREATE_NEW);
            JsonObject report = new JsonObject(); report.addProperty("status", "success"); report.addProperty("nativeReadback", true); report.addProperty("actors", actors.size()); report.addProperty("cameras", cameras.size()); report.addProperty("poseTracks", actualPoseTracks); report.addProperty("mode", mode); report.addProperty("runtimeAcceptance", "not-run");
            Files.writeString(stage.resolve("export-report.json"), JSON.toJson(report), StandardOpenOption.CREATE_NEW);
            Files.writeString(stage.resolve("README.txt"), "BBS FS 2.4 local Film export. Copy films/ and assets/ into the matching BBS FS asset roots manually. This package was not installed or tested in a game.\n", StandardOpenOption.CREATE_NEW);
            try (var files = Files.list(filmsDir)) {
                for (Path file : files.toList()) if (!file.equals(nativeFilm)) Files.deleteIfExists(file);
            }
            deleteTree(stateDir);
            try { Files.move(stage, finalDir, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException ignored) { Files.move(stage, finalDir); }
            moved = true;
            JsonObject result = new JsonObject(); result.addProperty("ok", true); result.addProperty("packageDirectory", finalDir.toString()); result.addProperty("filmPath", finalDir.resolve("films").resolve(nativeFilm.getFileName()).toString()); result.addProperty("sha256", sha256(finalDir.resolve("films").resolve(nativeFilm.getFileName()))); result.addProperty("sourceRevision", revision); result.addProperty("actors", actors.size()); result.addProperty("cameras", cameras.size()); result.addProperty("nativeReadback", true);
            return result;
        } finally {
            if (!moved) deleteTree(stage);
        }
    }

    private static JsonElement require(JsonObject object, String key) { if (!object.has(key) || object.get(key).isJsonNull()) throw new IllegalArgumentException("Missing " + key); return object.get(key); }
    private static String text(JsonObject object, String key) { JsonElement v = require(object, key); if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("Expected string: " + key); return v.getAsString(); }
    private static JsonArray array(JsonObject object, String key, int min, int max) { JsonElement v = require(object, key); if (!v.isJsonArray() || v.getAsJsonArray().size() < min || v.getAsJsonArray().size() > max) throw new IllegalArgumentException("Invalid array size: " + key); return v.getAsJsonArray(); }
    private static double finite(JsonObject object, String key) { JsonElement v = require(object, key); if (!v.isJsonPrimitive() || !v.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("Expected number: " + key); double n=v.getAsDouble(); if (!Double.isFinite(n) || Math.abs(n)>Float.MAX_VALUE) throw new IllegalArgumentException("Out-of-range number: " + key); return n; }
    private static int integer(JsonObject object, String key, int min, int max) { double v=finite(object,key); if(v!=Math.rint(v)||v<min||v>max) throw new IllegalArgumentException("Out-of-range integer: " + key); return (int)v; }
    private static long longInteger(JsonObject object, String key, long min, long max) {
        JsonElement value = require(object, key);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("Expected integer: " + key);
        try {
            long number = value.getAsBigDecimal().longValueExact();
            if (number < min || number > max) throw new IllegalArgumentException("Out-of-range integer: " + key);
            return number;
        } catch (ArithmeticException | NumberFormatException error) {
            throw new IllegalArgumentException("Out-of-range integer: " + key, error);
        }
    }
    private static boolean safeModelId(String value) { return value.matches("[a-z0-9_-]+(?:/[a-z0-9_-]+)*") && !value.contains(".."); }
    private static boolean safeAssetPath(String value) { if(value.isBlank()||value.length()>240||value.startsWith("/")||value.contains("\\")||value.contains(":")) return false; for(String part:value.split("/")) if(part.isBlank()||part.equals(".")||part.equals("..")||!part.matches("[A-Za-z0-9_.-]{1,128}")) return false; return true; }
    private static void validateTicks(JsonArray keys, int duration, String field) { int prev=-1; for(JsonElement e:keys) { if(!e.isJsonObject()) throw new IllegalArgumentException("Invalid " + field); int tick=integer(e.getAsJsonObject(),"tick",0,duration); if(tick<=prev) throw new IllegalArgumentException(field+" ticks must be strictly increasing"); prev=tick; } }
    private static void validateRelativeTicks(JsonArray keys, int duration) { int prev=-1; for(JsonElement e:keys) { JsonObject key=e.getAsJsonObject(); int tick=integer(key,"tick",0,duration); if(tick<=prev) throw new IllegalArgumentException("Camera keyframe ticks must be strictly increasing"); prev=tick; } }
    private static Set<String> strings(JsonArray array) { Set<String> result=new HashSet<>(); for(JsonElement e:array) { if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString()||!result.add(e.getAsString())) throw new IllegalArgumentException("Invalid or duplicate string list value"); } return result; }
    private static String sha256(Path path) throws Exception { MessageDigest digest=MessageDigest.getInstance("SHA-256"); try(var in=Files.newInputStream(path)) { byte[] buffer=new byte[64*1024]; int n; while((n=in.read(buffer))!=-1) digest.update(buffer,0,n); } return HexFormat.of().formatHex(digest.digest()); }
    private static String sha256(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private static void deleteTree(Path root) throws IOException { if(!Files.exists(root,LinkOption.NOFOLLOW_LINKS)) return; try(var paths=Files.walk(root)) { for(Path path:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path); } }
}
