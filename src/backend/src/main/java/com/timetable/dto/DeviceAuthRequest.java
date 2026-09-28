package com.timetable.dto;

import com.timetable.security.DeviceIdentity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public class DeviceAuthRequest {
    @NotBlank(message = "设备凭据不能为空")
    @Size(min = 50, max = 50, message = "设备凭据格式不正确")
    @Pattern(regexp = DeviceIdentity.KEY_PATTERN, message = "设备凭据格式不正确")
    private String deviceKey;

    public String getDeviceKey() { return deviceKey; }
    public void setDeviceKey(String deviceKey) { this.deviceKey = deviceKey; }
}
