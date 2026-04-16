using System;
using System.Net.Http;
using System.Text;

public class CPHInline
{
    public bool Execute()
    {
        string apiUrl = CPH.GetGlobalVar<string>("avatar_api_url", true);
        string apiKey = CPH.GetGlobalVar<string>("avatar_api_key", true);
        string username = args["userName"].ToString();

        if (string.IsNullOrEmpty(apiUrl) || string.IsNullOrEmpty(apiKey))
        {
            CPH.LogWarn("[Avatar] Missing avatar_api_url or avatar_api_key global variables.");
            return false;
        }

        try
        {
            using (var client = new HttpClient())
            {
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                string safeUsername = username.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t");
                string json = "{\"username\":\"" + safeUsername + "\",\"platform\":\"twitch\"}";
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = client.PostAsync($"{apiUrl}/overlay/trigger", content).Result;
                string body = response.Content.ReadAsStringAsync().Result;

                CPH.LogInfo($"[Avatar] Twitch overlay trigger for {username}: {body}");
            }
        }
        catch (Exception ex)
        {
            CPH.LogWarn($"[Avatar] Twitch overlay trigger failed: {ex.Message}");
        }

        return true;
    }
}
