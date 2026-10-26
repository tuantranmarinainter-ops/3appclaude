package local.bbsmerged;

import com.google.gson.*;
import local.bbsmcp.data.BbsCodec;
import local.bbsmcp.data.BbsCodec.Node;
import local.bbsmcp.editor.FilmEditor;
import java.lang.reflect.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import static local.bbsmcp.data.BbsCodec.*;

/** BBS FS 2.4 data primitives. No game film is written here. */
public final class DraftEditor {
    static final List<String> SLOTS=List.of("idle","running","sprinting","crouching","crouching_idle","dying","falling","swipe","jump","jump_alt","hurt","land","shoot","consume","base_pre","base_post");
    private final FilmEditor editor;
    private static final Method SAVE;
    static {
        try { SAVE = FilmEditor.class.getDeclaredMethod("save", String.class, Node.class); SAVE.setAccessible(true); }
        catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
    }
    public DraftEditor(FilmEditor editor) { this.editor = editor; }
    static String str(JsonObject p, String k) { return FilmEditor.str(p, k); }
    static String text(JsonObject p, String k, String fallback) { return p.has(k) ? p.get(k).getAsString() : fallback; }
    static double num(JsonObject p, String k, double fallback) {
        double v = p.has(k) ? p.get(k).getAsDouble() : fallback;
        if (!Double.isFinite(v) || Math.abs(v)>Float.MAX_VALUE) throw new IllegalArgumentException("Out-of-range " + k);
        return v;
    }
    static int tick(JsonObject p, String k, int fallback) {
        double v = num(p, k, fallback);
        if (v < 0 || v > 1_000_000 || v != Math.rint(v)) throw new IllegalArgumentException("Invalid tick/range: " + k);
        return (int) v;
    }
    static boolean flag(JsonObject p, String k, boolean fallback) { return p.has(k) ? p.get(k).getAsBoolean() : fallback; }
    static Node group(Node n, String key) { return map(n).computeIfAbsent(key, k -> BbsCodec.map()); }
    static List<Node> array(Node n, String key) { return list(map(n).computeIfAbsent(key, k -> BbsCodec.list())); }
    static String text(Node n, String key, String fallback) { Node v = map(n).get(key); return v == null ? fallback : (String)v.value(); }
    static double value(Node n, String key, double fallback) { Node v = map(n).get(key); return v == null ? fallback : ((Number)v.value()).doubleValue(); }
    static Node actor(Node root, JsonObject p) {
        String id = p.has("replayId") ? str(p, "replayId") : str(p, "victimReplayId");
        int i = Integer.parseInt(id);
        List<Node> actors = array(root, "replays");
        if (i < 0 || i >= actors.size()) throw new IllegalArgumentException("Actor not found: " + id);
        return actors.get(i);
    }
    static void key(Node parent, String name, String type, int tick, Node v) {
        Node channel = map(parent).computeIfAbsent(name, k -> BbsCodec.map());
        String existing = text(channel, "type", type);
        if (!existing.equals(type)) throw new IllegalArgumentException("Channel type mismatch: " + name);
        map(channel).put("type", string(type));
        List<Node> frames = array(channel, "keyframes");
        frames.removeIf(f -> value(f, "tick", -1) == tick);
        Node frame = BbsCodec.map(); map(frame).put("tick", floating(tick)); map(frame).put("value", v);
        frames.add(frame); frames.sort(Comparator.comparingDouble(f -> value(f, "tick", 0)));
    }
    static void transform(Node a, JsonObject p, int tick) {
        Node channels = group(a, "keyframes");
        for (String name : List.of("x","y","z","pitch","yaw")) key(channels, name, "double", tick, number(num(p, name, 0)));
        for (String name : List.of("bodyYaw","headYaw")) key(channels, name, "double", tick, number(num(p, "yaw", 0)));
    }
    static double sample(Node a, String name, int tick) {
        Node ch = map(group(a, "keyframes")).get(name);
        if (ch == null || array(ch, "keyframes").isEmpty()) return 0;
        List<Node> frames = array(ch, "keyframes");
        Node previous = frames.get(0);
        for (Node next : frames) {
            if (value(next, "tick", 0) >= tick) {
                double ta = value(previous,"tick",0), tb = value(next,"tick",0);
                // ponytail: creator snapshots support linear/constant only; refuse curved tracks instead of guessing poses.
                String interp = text(previous,"interp","linear");
                if (!List.of("linear","constant").contains(interp)) throw new IllegalArgumentException("Creator snapshot needs linear/constant channel: " + name);
                double va = value(previous,"value",0), vb = value(next,"value",0);
                return tb == ta || tick <= ta || interp.equals("constant") ? va : va + (vb-va)*(tick-ta)/(tb-ta);
            }
            previous = next;
        }
        return value(previous,"value",0);
    }
    static JsonObject snapshot(Node a, String draft, int index, int tick) {
        JsonObject out = new JsonObject(); out.addProperty("filmId",draft); out.addProperty("replayId",String.valueOf(index));
        out.addProperty("name",text(a,"label","")); out.addProperty("tick",tick);
        Node form = group(a,"form"); out.addProperty("formType",text(form,"id","")); out.addProperty("modelId",text(form,"model",""));
        Node actor = map(a).get("actor"); out.addProperty("actorEntity", actor != null && ((Number)actor.value()).intValue()!=0);
        for (String name:List.of("x","y","z","yaw","pitch")) out.addProperty(name,sample(a,name,tick));
        return out;
    }
    static Node clip(Node root, String id) {
        if(id.matches("legacy:[0-9]+")) { int i=Integer.parseInt(id.substring(7)); List<Node> clips=array(root,"camera"); if(i<clips.size()&&text(clips.get(i),"mcp_id", "").isEmpty()) return clips.get(i); }
        for (Node c:array(root,"camera")) if (text(c,"mcp_id", "").equals(id)) return c;
        throw new IllegalArgumentException("Camera clip not found: " + id);
    }
    static JsonObject camera(Node c) {
        JsonObject out = toJson(c).getAsJsonObject(); out.addProperty("clipId",text(c,"mcp_id","")); out.addProperty("startTick",value(c,"tick",0)); return out;
    }
    public JsonElement invoke(String command, JsonObject p) throws Exception {
        String draft = str(p,"filmId"); Node root = editor.loadDraft(draft);
        JsonElement result = new JsonObject();
        switch (command) {
            case "get_film" -> { JsonObject o = toJson(root).getAsJsonObject(); o.addProperty("filmId",draft); o.addProperty("saved_to_game",false); return o; }
            case "list_actors" -> { JsonArray out = new JsonArray(); int i=0; for (Node a:array(root,"replays")) out.add(snapshot(a,draft,i++,tick(p,"tick",0))); return out; }
            case "add_actor", "create_particle_actor" -> {
                Node a=BbsCodec.map(); map(a).put("label",string(str(p,"label"))); map(a).put("enabled",bool(true)); map(a).put("actor",bool(flag(p,"actorEntity",false)));
                String actorType=text(p,"actorType","");
                boolean human=List.of("male","female").contains(actorType);
                Node form=group(a,"form"); map(form).put("id",string(command.equals("create_particle_actor") ? "bbs:particle" : human ? "bbs:mob" : "bbs:model"));
                if(human) { map(form).put("mobId",string("minecraft:player")); map(form).put("mobNbt",string("")); map(form).put("slim",bool(actorType.equals("female"))); map(a).put("actor",bool(true)); map(a).put("name_tag",string(str(p,"label"))); }
                if (command.equals("create_particle_actor")) { map(form).put("effect",string(str(p,"effectId"))); map(form).put("paused",bool(flag(p,"paused",false))); }
                transform(a,p,0); array(a,"actions"); group(a,"properties");
                List<Node> actors=array(root,"replays"); actors.add(a); result=snapshot(a,draft,actors.size()-1,0);
            }
            case "add_aaa_particle_actor" -> {
                // B15: one AAA Particles (Effekseer) replay per App 2 VFX cue, laid out like the addon's own film editor:
                // form bbs:aaa_particle (effect link, loop, particleScale) and boolean "visible"/"restart" tracks that
                // show it from startTick, restart it there and hide it again at endTick. "manual": placed and shown in the
                // same interval but paused, with no restart pulse, so the user starts it in BBS FS.
                boolean manual=flag(p,"manual",false);
                String effect=str(p,"effect");
                if(!effect.matches("[A-Za-z0-9_./-]{1,200}[.]efkefc")||effect.contains("..")||effect.startsWith("/")) throw new IllegalArgumentException("AAA effect must be an assets-relative .efkefc path");
                int duration=tick(p,"durationTicks",1), start=tick(p,"startTick",0), end=tick(p,"endTick",start+1);
                if(start>=end||end>duration) throw new IllegalArgumentException("AAA effect ticks must satisfy start < end <= duration");
                double scale=num(p,"scale",1); if(!(scale>0&&scale<=1000)) throw new IllegalArgumentException("AAA effect scale must be in (0,1000]");
                Node a=BbsCodec.map(); map(a).put("label",string(str(p,"label"))); map(a).put("enabled",bool(true)); map(a).put("actor",bool(false));
                Node form=group(a,"form"); map(form).put("id",string("bbs:aaa_particle")); map(form).put("effect",string("assets:"+effect));
                map(form).put("loop",bool(true)); map(form).put("paused",bool(manual)); map(form).put("restart",bool(false)); map(form).put("speed",number(1)); map(form).put("particleScale",number(scale));
                transform(a,p,0); transform(a,p,duration); array(a,"actions");
                Node props=group(a,"properties");
                if(start>0) key(props,"visible","boolean",0,bool(false));
                key(props,"visible","boolean",start,bool(true));
                if(end<duration) key(props,"visible","boolean",end,bool(false));
                if(!manual) {
                    if(start>0) key(props,"restart","boolean",0,bool(false));
                    key(props,"restart","boolean",start,bool(true));
                    key(props,"restart","boolean",Math.min(duration,start+2),bool(false));
                    // Hiding alone leaves spawned particles glowing in game (seen with "light"); pause at the end too.
                    if(end<duration) { key(props,"paused","boolean",start,bool(false)); key(props,"paused","boolean",end,bool(true)); }
                }
                List<Node> actors=array(root,"replays"); actors.add(a); result=snapshot(a,draft,actors.size()-1,0);
            }
            case "set_transform" -> { Node a=actor(root,p); transform(a,p,tick(p,"tick",0)); result=snapshot(a,draft,Integer.parseInt(str(p,"replayId")),tick(p,"tick",0)); }
            case "move_actor" -> {
                int startTick=tick(p,"startTick",0), endTick=tick(p,"endTick",0);
                if(endTick<=startTick) throw new IllegalArgumentException("endTick must be greater than startTick");
                Node a=actor(root,p); int index=Integer.parseInt(str(p,"replayId"));
                JsonObject start=snapshot(a,draft,index,startTick), end=p.deepCopy();
                if(!end.has("pitch")) end.add("pitch",start.get("pitch"));
                if(!end.has("yaw")) end.add("yaw",start.get("yaw"));
                transform(a,start,startTick); transform(a,end,endTick);
                JsonObject out=new JsonObject(); out.add("start",start); out.add("end",snapshot(a,draft,index,endTick)); result=out;
            }
            case "face_actor" -> {
                int t=tick(p,"tick",0), index=Integer.parseInt(str(p,"replayId"));
                Node a=actor(root,p); JsonObject targetId=new JsonObject(); targetId.add("replayId",p.get("targetReplayId"));
                Node target=actor(root,targetId); JsonObject pose=snapshot(a,draft,index,t);
                double yaw=Math.toDegrees(Math.atan2(-(sample(target,"x",t)-pose.get("x").getAsDouble()),sample(target,"z",t)-pose.get("z").getAsDouble()));
                pose.addProperty("yaw",yaw); transform(a,pose,t);
                JsonObject out=new JsonObject(); out.addProperty("yaw",yaw); out.add("result",snapshot(a,draft,index,t)); result=out;
            }
            case "set_transform_keyframes" -> {
                JsonArray frames=p.getAsJsonArray("keyframes");
                if(frames==null||frames.isEmpty()||frames.size()>256) throw new IllegalArgumentException("Expected 1-256 transform keyframes");
                for(JsonElement frame:frames) { JsonObject f=frame.getAsJsonObject(); transform(actor(root,f),f,tick(f,"tick",0)); }
                JsonObject out=new JsonObject(); out.addProperty("filmId",draft); out.addProperty("applied",frames.size()); result=out;
            }
            case "set_model_form" -> {
                Node form=group(actor(root,p),"form"); if (!text(form,"id","").equals("bbs:model")) throw new IllegalArgumentException("Requires ModelForm; refusing to destroy another form");
                map(form).put("model",string(str(p,"modelId")));
                if(p.has("formScale") || p.has("formOffsetY")) {
                    double scale=num(p,"formScale",1), offset=num(p,"formOffsetY",0);
                    if(!(scale>0 && scale<=1000)) throw new IllegalArgumentException("Model form scale must be in (0,1000]");
                    Node transform=group(form,"transform"), size=BbsCodec.list(), translation=BbsCodec.list();
                    for(int axis=0;axis<3;axis++) { list(size).add(floating((float)scale)); list(translation).add(floating((float)(axis==1?offset:0))); }
                    map(transform).put("s",size); map(transform).put("t",translation);
                }
            }
            case "set_pose_transform_keyframes" -> {
                String bone=str(p,"boneName");
                if(!bone.matches("[A-Za-z0-9_.-]{1,128}")) throw new IllegalArgumentException("Invalid BOBJ bone name");
                JsonArray frames=p.getAsJsonArray("keyframes");
                if(frames==null||frames.isEmpty()||frames.size()>256) throw new IllegalArgumentException("Expected 1-256 pose keyframes");
                Node properties=group(actor(root,p),"properties");
                for(JsonElement element:frames) {
                    JsonObject frame=element.getAsJsonObject(); int at=tick(frame,"tick",0);
                    Node value=BbsCodec.map();
                    for(String component:List.of("t","s","r","r2")) {
                        JsonArray vector=frame.getAsJsonArray(component);
                        if(vector==null||vector.size()!=3) throw new IllegalArgumentException(component+" must have three values");
                        Node values=BbsCodec.list();
                        for(JsonElement item:vector) { double v=item.getAsDouble(); if(!Double.isFinite(v)||Math.abs(v)>Float.MAX_VALUE) throw new IllegalArgumentException("Invalid pose value"); list(values).add(floating((float)v)); }
                        map(value).put(component,values);
                    }
                    double fix=num(frame,"fix",0), lighting=num(frame,"lighting",0); int color=frame.has("color")?frame.get("color").getAsInt():-1;
                    map(value).put("fix",floating((float)fix)); map(value).put("color",integer(color)); map(value).put("lighting",floating((float)lighting));
                    key(properties,"pose.bones."+bone,"pose_transform",at,value);
                }
            }
            case "set_visibility_keyframe" -> {
                Node a=actor(root,p); Node form=group(a,"form"); Node props=group(a,"properties");
                if (!map(props).containsKey("visible") && tick(p,"timelineTick",0)>0) key(props,"visible","boolean",0,map(form).getOrDefault("visible",bool(true)));
                key(props,"visible","boolean",tick(p,"timelineTick",0),bool(flag(p,"visible",true)));
            }
            case "set_damage_reaction" -> {
                Node ch=group(actor(root,p),"keyframes"); int t=tick(p,"timelineTick",0), hurt=tick(p,"hurtTicks",10);
                if(hurt>20) throw new IllegalArgumentException("hurtTicks <= 20");
                if(t>0) key(ch,"damage","double",t-1,number(0)); key(ch,"damage","double",t,number(hurt)); key(ch,"damage","double",t+hurt,number(0));
            }
            case "add_swipe_action" -> {
                Node c=BbsCodec.map(); map(c).put("type",string("bbs:swipe")); map(c).put("tick",integer(tick(p,"timelineTick",0))); map(c).put("duration",integer(Math.max(1,tick(p,"duration",1)))); map(c).put("enabled",bool(true)); array(actor(root,p),"actions").add(c);
            }
            case "set_action_mapping", "add_animation_keyframe", "list_animations" -> {
                Node a=actor(root,p), form=group(a,"form"); if(!text(form,"id","").equals("bbs:model")) throw new IllegalArgumentException("Requires ModelForm");
                Node config=group(form,"actions");
                if(command.equals("list_animations")) { JsonObject o=new JsonObject(); o.add("mappings",toJson(config)); o.addProperty("modelId",text(form,"model","")); o.addProperty("animationDiscovery","Use model_bones/list_models; validate names in game"); return o; }
                Node mapping=BbsCodec.map(); map(mapping).put("name",string(str(p,"animationName"))); map(mapping).put("loop",bool(flag(p,"loop",true)));
                double speed=num(p,"speed",1), fade=num(p,"fade",5); if(speed<=0||fade<0) throw new IllegalArgumentException("Invalid animation speed/fade");
                map(mapping).put("speed",floating((float)speed)); map(mapping).put("fade",floating((float)fade)); map(mapping).put("tick",integer(tick(p,"actionTick",0)));
                String slot=str(p,"slot");
                if(!SLOTS.contains(slot)) throw new IllegalArgumentException("Unknown BBS action slot: "+slot);
                if(command.equals("set_action_mapping")) map(config).put(slot,mapping);
                else {
                    Node props=group(a,"properties"); int t=tick(p,"timelineTick",0); Node previous=deepCopy(config);
                    Node channel=map(props).get("actions");
                    if(channel!=null) for(Node frame:array(channel,"keyframes")) if(value(frame,"tick",0)<=t) previous=deepCopy(map(frame).get("value"));
                    if(channel==null&&t>0) key(props,"actions","actions_config",0,deepCopy(config));
                    map(previous).put(slot,mapping); key(props,"actions","actions_config",t,previous);
                }
            }
            case "list_camera_clips" -> { JsonArray out=new JsonArray(); int i=0; for(Node c:array(root,"camera")) { JsonObject o=camera(c); if(text(c,"mcp_id", "").isEmpty()) o.addProperty("clipId","legacy:"+i); out.add(o); i++; } return out; }
            case "get_camera_clip" -> { return camera(clip(root,str(p,"clipId"))); }
            case "add_camera_clip", "duplicate_camera_clip" -> {
                Node c=command.equals("duplicate_camera_clip")?deepCopy(clip(root,str(p,"clipId"))):BbsCodec.map();
                String id=UUID.randomUUID().toString(); map(c).put("mcp_id",string(id)); map(c).put("tick",integer(tick(p,"startTick",0)));
                if(p.has("title")) map(c).put("title",string(p.get("title").getAsString()));
                if(command.equals("add_camera_clip")) {
                    int duration=tick(p,"duration",1); if(duration<1) throw new IllegalArgumentException("duration >= 1");
                    map(c).put("type",string("bbs:keyframe")); map(c).put("duration",integer(duration)); map(c).put("layer",integer(tick(p,"layer",0))); map(c).put("additive",bool(flag(p,"additive",false))); map(c).put("enabled",bool(true));
                }
                array(root,"camera").add(c); result=camera(c);
            }
            case "add_camera_keyframe", "set_camera_transform", "set_camera_fov" -> {
                Node c=clip(root,str(p,"clipId")); if(!text(c,"type","").equals("bbs:keyframe")) throw new IllegalArgumentException("Requires KeyframeClip");
                int t=tick(p,"relativeTick",0); if(t>value(c,"duration",1)) throw new IllegalArgumentException("Keyframe beyond camera duration");
                boolean supplied=false;
                for(String name:List.of("x","y","z","yaw","pitch","roll","fov","distance")) if(p.has(name)) {
                    double v=num(p,name,0); if(name.equals("fov")&&(v<=0||v>=180)) throw new IllegalArgumentException("FOV must be (0,180)"); key(c,name,"double",t,number(v)); supplied=true;
                }
                if(!supplied) throw new IllegalArgumentException("No camera channels supplied"); result=camera(c);
            }
            case "add_subtitle_clip" -> {
                String speaker=str(p,"speaker"),message=str(p,"message"); if(speaker.length()>32||message.length()>240) throw new IllegalArgumentException("Speaker <=32 and dialogue <=240 characters");
                Node c=BbsCodec.map(); String color=speaker.equalsIgnoreCase("Nữ")||speaker.toLowerCase(Locale.ROOT).contains("nữ")?"§d":"§b";
                map(c).put("type",string("bbs:subtitle")); map(c).put("tick",integer(tick(p,"startTick",0))); map(c).put("duration",integer(tick(p,"duration",40))); map(c).put("layer",integer(0)); map(c).put("enabled",bool(true)); map(c).put("title",string(color+speaker+"§f: "+message));
                map(c).put("anchorX",floating(0.5f)); map(c).put("anchorY",floating(0.78f)); map(c).put("windowX",floating(0.5f)); map(c).put("windowY",floating(0.78f)); map(c).put("textShadow",bool(true)); array(root,"camera").add(c); result=camera(c);
            }
            case "add_audio_clip" -> {
                int start=tick(p,"startTick",0), duration=tick(p,"duration",1), layer=tick(p,"layer",0); String title=text(p,"title","Dialogue");
                if(duration<1||title.length()>120) throw new IllegalArgumentException("duration >= 1 and title <= 120 characters");
                byte[] wav;
                try { wav=Base64.getDecoder().decode(str(p,"wavBase64")); }
                catch(IllegalArgumentException e) { throw new IllegalArgumentException("Invalid WAV payload"); }
                if(wav.length<44||wav.length>700_000||!new String(wav,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")||!new String(wav,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WAVE")) throw new IllegalArgumentException("Expected a WAV file up to 700 KB");
                String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(wav));
                Path folder=((java.io.File)Class.forName("mchorse.bbs_mod.BBSMod").getMethod("getAudioFolder").invoke(null)).toPath();
                Files.createDirectories(folder); Path file=folder.resolve("mcp-tts-"+hash+".wav");
                try { Files.write(file,wav,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE); }
                catch(FileAlreadyExistsException exists) { if(!MessageDigest.isEqual(wav,Files.readAllBytes(file))) throw new IllegalStateException("Existing audio asset does not match its content hash"); }
                Node c=BbsCodec.map(); String id=UUID.randomUUID().toString();
                map(c).put("mcp_id",string(id)); map(c).put("type",string("bbs:audio")); map(c).put("tick",integer(start));
                map(c).put("duration",integer(duration)); map(c).put("layer",integer(layer)); map(c).put("enabled",bool(true)); map(c).put("title",string(title));
                map(c).put("audio",string("assets:audio/"+file.getFileName())); map(c).put("offset",integer(0)); array(root,"camera").add(c); result=camera(c);
            }
            case "remove_camera_clip" -> array(root,"camera").remove(clip(root,str(p,"clipId")));
            case "set_particle_effect", "set_particle_parameter", "set_particle_paused" -> {
                Node a=actor(root,p), form=group(a,"form"); if(!text(form,"id","").equals("bbs:particle")) throw new IllegalArgumentException("Requires ParticleForm");
                if(command.equals("set_particle_effect")) map(form).put("effect",string(str(p,"effectId")));
                else if(command.equals("set_particle_parameter")) { String parameter=str(p,"parameter"); if(!parameter.matches("user[1-6]")) throw new IllegalArgumentException("Invalid particle parameter"); map(form).put(parameter,floating((float)num(p,"value",0))); }
                else if(p.has("timelineTick")) {
                    Node props=group(a,"properties"); int t=tick(p,"timelineTick",0);
                    if(!map(props).containsKey("paused")&&t>0) key(props,"paused","boolean",0,map(form).getOrDefault("paused",bool(false)));
                    key(props,"paused","boolean",t,bool(flag(p,"paused",false)));
                } else map(form).put("paused",bool(flag(p,"paused",false)));
            }
            case "play_animation_now" -> throw new UnsupportedOperationException("Use scene_play_animation and preview_film; immediate actor mutation is intentionally disabled");
            default -> throw new IllegalArgumentException("Unknown command: " + command);
        }
        {
            // Keep the reference placeholder long enough for actor/property/action tracks.
            double end=Math.max(FilmEditor.duration(root),FilmEditor.lastTick(root)+1);
            if(end>1_000_001) throw new IllegalArgumentException("Draft timeline limit exceeded");
            for(Node c:array(root,"camera")) if(text(c,"title","").equals("MCP timeline")&&text(c,"type","").equals("bbs:idle")) map(c).put("duration",integer((int)Math.ceil(end)));
            // Reference save performs bounded encoding before atomic replacement.
            try { JsonObject saved=(JsonObject)SAVE.invoke(editor,draft,root); result.getAsJsonObject().add("draftSave",saved); }
            catch(InvocationTargetException e) { throw (Exception)e.getCause(); }
        }
        return result;
    }
}
