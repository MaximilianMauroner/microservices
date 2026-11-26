const { mkdirSync, writeFileSync } = require("node:fs");
const privacy = require("../assets/health-connect-privacy.json");
const { join } = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod, withGradleProperties } = require("expo/config-plugins");

const rationaleAction = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const activityName = ".HealthConnectRationaleActivity";

module.exports = function withHealthConnectRationale(config) {
  const packageName = config.android.package;

  config = withGradleProperties(config, (config) => {
    const key = "android.minSdkVersion";
    const properties = config.modResults;
    const existing = properties.find((item) => item.type === "property" && item.key === key);
    if (existing) existing.value = String(Math.max(26, Number(existing.value)));
    else properties.push({ type: "property", key, value: "26" });
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const filters = main["intent-filter"] ?? [];
    const rationale = filters.find((filter) =>
      filter.action?.some((action) => action.$["android:name"] === rationaleAction)
    );
    if (!rationale) throw new Error("The Health Connect rationale filter is missing.");
    main["intent-filter"] = filters.filter((filter) => filter !== rationale);
    const activity = application.activity.find((activity) => activity.$["android:name"] === activityName);
    if (activity) activity["intent-filter"] = [rationale];
    else application.activity.push({
      $: { "android:name": activityName, "android:exported": "true" },
      "intent-filter": [rationale],
    });
    const alias = application["activity-alias"].find(
      (alias) => alias.$["android:name"] === "ViewPermissionUsageActivity"
    );
    alias.$["android:targetActivity"] = activityName;
    return config;
  });

  return withDangerousMod(config, ["android", (config) => {
    const directory = join(config.modRequest.platformProjectRoot, "app/src/main/java", ...packageName.split("."));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "HealthConnectRationaleActivity.kt"), `package ${packageName}

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale

class HealthConnectRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val german = Locale.getDefault().language == "de"
    val heading = if (german) ${JSON.stringify(privacy.de.title)} else ${JSON.stringify(privacy.en.title)}
    val policy = if (german) ${JSON.stringify(privacy.de.body)} else ${JSON.stringify(privacy.en.body)}
    title = heading
    val inset = (24 * resources.displayMetrics.density).toInt()
    setContentView(ScrollView(this).apply {
      addView(TextView(this@HealthConnectRationaleActivity).apply {
        setPadding(inset, inset, inset, inset)
        textSize = 16f
        text = heading + "\\n\\n" + policy
        setTextIsSelectable(true)
      })
    })
  }
}
`);
    return config;
  }]);
};
