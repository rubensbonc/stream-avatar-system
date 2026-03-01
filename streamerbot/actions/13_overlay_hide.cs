using System;
using System.Net.Http;
using System.Text;

public class CPHInline
{
    public bool Execute()
    {
        string apiUrl = CPH.GetGlobalVar<string>("avatar_api_url", true);
        string apiKey = CPH.GetGlobalVar<string>("avatar_api_key", true);

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

                var content = new StringContent("{}", Encoding.UTF8, "application/json");
                var response = client.PostAsync($"{apiUrl}/overlay/hide", content).Result;
                string body = response.Content.ReadAsStringAsync().Result;

                CPH.LogInfo($"[Avatar] Overlay hidden: {body}");
            }
        }
        catch (Exception ex)
        {
            CPH.LogWarn($"[Avatar] Hide overlay failed: {ex.Message}");
        }

        return true;
    }
}
