
<%@ Page MasterPageFile="~/MasterPage.master" Language="c#" Title="Contact Us" EnableViewState="false" %>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Postal" %>
<%@ Import Namespace="Jwayela.Data"%>
<%@ Import Namespace="System.Threading"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Helpers"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.Data"%>
<%@ Import Namespace="Jwayela.BriefYourMarket.Model.MetaData"%>
<script runat="server" language="c#">
    private string GetSetting(string name)
    {
        LookupValue brandValue = BrandValue.GetCurrentBrand(true);
        string settingValue = string.Format("Setting [{0}] not found!", name);
        try
        {
            if (brandValue != null && brandValue.Value != null)
            {
                settingValue = brandValue.GetSettingValue(name);
            }
            else
            {
                Brand brand = new Brand();
                LookupValueSpecificSettingDefault setting = brand.PropertyType.GetSetting(name);
                settingValue = setting != null ? setting.DefaultValue : GetGlobalSetting(name);
            }
        }
        catch (Exception e)
        {
            // ignore
        }

        return settingValue;
    }

    private static string GetGlobalSetting(string name)
    {
        string settingValue;
        string value = Settings.SettingsProvider.GetSettingValue(name);
        settingValue = !string.IsNullOrEmpty(value) ? value : "";
        return settingValue;
    }


    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        IndividualMessage newContactUsMessage = new IndividualMessage();
        string Subject = "";
        try
        {
            Subject = Interaction.Get(int.Parse((new HttpHelper()).GetCookie("InitialInteraction").Value)).Subject;
        }
        catch
        {
            Subject = "No Subject Found.";
        }
        
        if (!IsPostBack)
        {
            ContactBase contact = ContactBase.GetLoggedInContact();
            if (contact != null)
            {                
                Log.Logger.InfoFormat("Found Contact {0}", contact.EMail);
                newContactUsMessage.HtmlBody = string.Format(@"<p>The person below wishes to be contacted about a Valuation.</p>
                <p>Subject: {0}</p>
                <p>First Name: {1}</p>
	            <p>Last Name : {2}</p>
                <p>Email: {3}</p>
                <p>Mobile Number: {4}</p>", Subject, contact.FirstName, contact.LastName, contact.EMail, Settings.ContactType.GetProperty("Mobile").GetValue(contact, null), contact.Mobile);

                newContactUsMessage.TextBody = string.Format(@"The person below wishes to be contacted about a Valuation
                Subject: {0}
                First Name: {1}
	            Last Name : {2}
                Email: {3}
                Mobile Number: {4}", Subject, contact.FirstName, contact.LastName, contact.EMail, Settings.ContactType.GetProperty("Mobile").GetValue(contact, null), contact.Mobile);

                Log.Logger.Debug("Sending Expression of Contact.");

                newContactUsMessage.Template = Template.Get("Call To Action");

                if (newContactUsMessage.Template != null && newContactUsMessage.Template.Id > 0)
                {
                    newContactUsMessage.Template = Repository.Get<Template>(newContactUsMessage.Template.Id); // Might be getting template from the session and not reattaching, hack basically
                }
                
                newContactUsMessage.Title = "Contact this person";

                IList<LookupValue> lists = PropertyType.GetPropertyType(typeof(ContactLists)).GetLookupValues();
                foreach (LookupValue contactList in lists)
                {
                    if (contactList.ToString() == "!!Valuation Call To Action Recipients")
                    {
                        newContactUsMessage.SendToList = contactList;
                        break;
                    }
                }

                Log.Logger.Info(newContactUsMessage.HtmlBody);

                if (newContactUsMessage.SendToList != null)
                {
                    DataAccess.Save(newContactUsMessage);
                    newContactUsMessage.Send(DateTime.Now, null);
                }
                else
                {
                    Log.Logger.Error("Failed to Send Message");

                }

                    //Response.Redirect("ContactUsComplete.aspx");
                
            }
            else
            {
                Log.Logger.InfoFormat("No Contact Found");
            }
        }
    }

    protected void OnCancel(object sender, EventArgs e)
    {
        Response.Redirect("~/");
    }

   
</script>

<asp:Content ID="Content1" ContentPlaceHolderID="MainContentHolder" runat="server">
    <div id="contentContainer">
        <h2 style="padding-top: 20px;">
            Thank you for requesting a Valuation.</h2>
        <p>
            One of our agents has been informed with your details,
            and will be in touch with you shortly to discuss your
            request further.</p>
    </div>
</asp:Content>
