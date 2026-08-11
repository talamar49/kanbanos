package com.kanbanos.mobile;

import static org.junit.Assert.assertEquals;

import com.getcapacitor.BridgeActivity;
import org.junit.Test;

public class MainActivityTest {
    @Test
    public void activityUsesTheCapacitorBridge() {
        assertEquals(BridgeActivity.class, MainActivity.class.getSuperclass());
    }
}
