package cn.tripagentai.studyapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FocusLockPlugin.class);
        registerPlugin(WordSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
