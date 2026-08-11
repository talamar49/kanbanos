package com.kanbanos.mobile;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ApplicationIdTest {
    @Test
    public void installedAppUsesTheProductionApplicationId() {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.kanbanos.mobile", app.getPackageName());
    }
}
