package cn.tripagentai.studyapp;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Uses an installed offline English voice only. No cloud API or model quota. */
@CapacitorPlugin(name = "WordSpeech")
public class WordSpeechPlugin extends Plugin {
    private TextToSpeech engine;
    private volatile int initialized = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<String, PluginCall> pending = new ConcurrentHashMap<>();

    @Override public void load() {
        handler.post(() -> {
            engine = new TextToSpeech(getContext(), status -> initialized = status == TextToSpeech.SUCCESS ? 1 : -1);
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { finish(id, null); }
                @Override public void onError(String id) { finish(id, "播放失败，请检查系统英文语音包"); }
                @Override public void onStop(String id, boolean interrupted) { finish(id, null); }
            });
        });
    }

    private void finish(String id, String message) {
        PluginCall call = pending.remove(id);
        if (call == null) return;
        if (message == null) call.resolve(); else call.reject(message, "SPEECH_FAILED");
    }

    private void stopAll() {
        for (String id : pending.keySet()) finish(id, null);
        if (engine != null) engine.stop();
    }

    @PluginMethod public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > 200) { call.reject("朗读内容为空或过长"); return; }
        handler.post(() -> {
            stopAll();
            String id = UUID.randomUUID().toString();
            pending.put(id, call);
            long deadline = System.currentTimeMillis() + 6000;
            Runnable start = new Runnable() {
                @Override public void run() {
                    if (!pending.containsKey(id)) return;
                    if (initialized == 0 && System.currentTimeMillis() < deadline) { handler.postDelayed(this, 100); return; }
                    if (initialized != 1 || engine == null) { finish(id, "系统语音引擎不可用，请在系统设置中安装英文语音包"); return; }
                    try {
                        Voice selected = null;
                        if (engine.getVoices() != null) for (Voice voice : engine.getVoices()) {
                            if (!"en".equals(voice.getLocale().getLanguage()) || voice.isNetworkConnectionRequired()
                                || (voice.getFeatures() != null && voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) continue;
                            if (selected == null || (Locale.US.equals(voice.getLocale()) && !Locale.US.equals(selected.getLocale()))
                                || (voice.getLocale().equals(selected.getLocale()) && voice.getQuality() > selected.getQuality())) selected = voice;
                        }
                        if (selected == null || engine.setVoice(selected) == TextToSpeech.ERROR) { finish(id, "缺少离线英文语音，请到系统文字转语音设置安装英文语音包"); return; }
                        engine.setSpeechRate(0.85f);
                        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) finish(id, "系统无法朗读，请检查英文语音包");
                        handler.postDelayed(() -> { if (pending.containsKey(id)) { finish(id, "朗读超时，请检查系统语音设置"); engine.stop(); } }, 30000);
                    } catch (Exception error) { finish(id, "系统语音不可用，请检查英文语音包"); }
                }
            };
            start.run();
        });
    }

    @PluginMethod public void stop(PluginCall call) { handler.post(() -> { stopAll(); call.resolve(); }); }

    @PluginMethod public void openSettings(PluginCall call) {
        handler.post(() -> {
            try { getActivity().startActivity(new Intent("com.android.settings.TTS_SETTINGS")); call.resolve(); }
            catch (Exception error) {
                try { getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS)); call.resolve(); }
                catch (Exception fallback) { call.reject("请手动打开系统设置，搜索文字转语音"); }
            }
        });
    }

    @Override protected void handleOnPause() { handler.post(this::stopAll); }
    @Override protected void handleOnDestroy() {
        handler.post(() -> { stopAll(); if (engine != null) engine.shutdown(); engine = null; initialized = -1; });
    }
}
